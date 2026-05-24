/**
 * Idempotency 미들웨어 (Phase 2-B, B2)
 *
 * 변경 요청(POST/PUT/PATCH/DELETE)에 Idempotency-Key 헤더가 있으면
 * Redis에 (key → {status, body}) 를 캐싱하여 동일 키 재요청 시 캐시 응답을 반환.
 *
 * 동작 흐름:
 *  1. 헤더 없음 → 통과
 *  2. 키 존재(기처리) → 캐시된 {status, body} 반환 (X-Idempotent-Replayed: true)
 *  3. 키 존재(처리 중) → 409 DUPLICATE_REQUEST
 *  4. 키 없음 → "in-progress" 마킹 후 통과 → 응답 캡처 후 캐시 저장 (TTL 24h)
 *
 * 단일 인스턴스(D-2) 환경이지만 Redis 사용으로 서버 재시작 후에도 idempotency 보존.
 * Redis 장애 시 미들웨어는 통과(fail-open)하여 서비스 중단 방지.
 */

import { Request, Response, NextFunction } from 'express';
import { redis } from '@pvpentech/shared/config/redis';
import { logger } from '@pvpentech/shared/config/logger';
import { InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';

const IDEMPOTENCY_TTL_SEC = 86400; // 24시간
const IN_PROGRESS_MARKER = '__IN_PROGRESS__';
const IN_PROGRESS_TTL_SEC = 120; // 처리 중 마커는 최대 2분 (OCPP timeout 30s + margin)

// ─── Redis 키 네임스페이스 ─────────────────────────────────────────────────

function redisKey(key: string): string {
  return `idempotency:internal:${key}`;
}

// ─── 캐시 저장/조회 헬퍼 ─────────────────────────────────────────────────

interface CachedResponse {
  status: number;
  body: unknown;
}

async function getCached(key: string): Promise<CachedResponse | '__IN_PROGRESS__' | null> {
  try {
    const raw = await redis.get(redisKey(key));
    if (!raw) return null;
    if (raw === IN_PROGRESS_MARKER) return IN_PROGRESS_MARKER;
    return JSON.parse(raw) as CachedResponse;
  } catch (err) {
    logger.warn({ err, key }, 'Idempotency: failed to read from Redis (fail-open)');
    return null;
  }
}

async function setInProgress(key: string): Promise<void> {
  try {
    // NX: 이미 존재하면 쓰지 않음 (경쟁 조건 방지)
    await redis.set(redisKey(key), IN_PROGRESS_MARKER, 'EX', IN_PROGRESS_TTL_SEC, 'NX');
  } catch (err) {
    logger.warn({ err, key }, 'Idempotency: failed to set in-progress marker (fail-open)');
  }
}

async function setCompleted(key: string, status: number, body: unknown): Promise<void> {
  try {
    const value = JSON.stringify({ status, body } satisfies CachedResponse);
    await redis.set(redisKey(key), value, 'EX', IDEMPOTENCY_TTL_SEC);
  } catch (err) {
    logger.warn({ err, key }, 'Idempotency: failed to cache completed response (fail-open)');
  }
}

// ─── 미들웨어 ──────────────────────────────────────────────────────────────

export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  // 헤더 없으면 통과 (GET 등 read-only 요청은 idempotency 불필요)
  if (!idempotencyKey) {
    next();
    return;
  }

  // 비동기 처리를 IIFE로 래핑 (Express 미들웨어는 async 직접 지원 안 함)
  void (async () => {
    const cached = await getCached(idempotencyKey);

    if (cached === IN_PROGRESS_MARKER) {
      // 처리 중인 동일 요청이 있음 → 409
      const err = InternalApiErrors.duplicateRequest(idempotencyKey);
      res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
      return;
    }

    if (cached !== null) {
      // 이미 처리 완료된 요청 → 캐시 응답 반환
      logger.debug({ idempotencyKey }, 'Idempotency: replaying cached response');
      res.set('X-Idempotent-Replayed', 'true');
      res.status(cached.status).json(cached.body);
      return;
    }

    // 최초 요청 — in-progress 마킹 후 통과
    await setInProgress(idempotencyKey);

    // 응답 캡처: res.json를 래핑하여 응답 완료 시 Redis에 저장
    const originalJson = res.json.bind(res) as (body: unknown) => Response;

    res.json = (body: unknown): Response => {
      // 완료 상태(2xx/3xx/4xx 포함)만 캐싱 — 5xx 에러는 캐싱하지 않음(재시도 가능)
      if (res.statusCode < 500) {
        void setCompleted(idempotencyKey, res.statusCode, body);
      }
      return originalJson(body);
    };

    next();
  })();
}
