/**
 * Internal API 인증 미들웨어 (Phase 2-B, B1)
 *
 * Portal → Core 서비스 간 HTTP 호출에 사용하는 Bearer 토큰 인증.
 *
 * 보안 원칙:
 *  - timing-safe 비교 (crypto.timingSafeEqual) — timing-attack 방어
 *  - 환경변수 미설정 시 서버 부팅 자체를 실패시켜 미설정 상태 노출 차단
 *  - 복수 토큰 지원: CSMS_INTERNAL_API_TOKEN=token1,token2,...
 */

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { logger } from '@pvpentech/shared/config/logger';
import { InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';

// ─── 토큰 집합 초기화 ────────────────────────────────────────────────────────

function loadTokens(): Set<string> {
  const raw = process.env.CSMS_INTERNAL_API_TOKEN;

  if (!raw || raw.trim().length === 0) {
    logger.fatal(
      'CSMS_INTERNAL_API_TOKEN environment variable is not set. ' +
        'Internal API will not start. Set a random string of at least 32 characters.',
    );
    throw new Error('CSMS_INTERNAL_API_TOKEN must be configured before starting the server.');
  }

  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length >= 32);

  if (tokens.length === 0) {
    logger.fatal(
      'CSMS_INTERNAL_API_TOKEN contains no valid tokens (each token must be ≥ 32 characters).',
    );
    throw new Error('CSMS_INTERNAL_API_TOKEN: all tokens are shorter than 32 characters.');
  }

  logger.info({ tokenCount: tokens.length }, 'Internal API: service tokens loaded');
  return new Set(tokens);
}

// 모듈 로드 시 1회 초기화 — 실패하면 프로세스 종료
const VALID_TOKENS: Set<string> = loadTokens();

// ─── timing-safe 비교 헬퍼 ───────────────────────────────────────────────────

/**
 * timing-safe 문자열 비교.
 * 길이가 다른 경우 false 반환 (길이 차이로 인한 timing leak 방지를 위해 dummy 비교 수행).
 */
function timingSafeEqual_str(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // 길이가 다르면 false — 단, 시간 측정으로 길이를 알 수 없도록 dummy 비교 실행
  if (bufA.length !== bufB.length) {
    // dummy 비교: VALID_TOKEN 길이와 무관한 고정 길이 비교
    const dummy = Buffer.alloc(bufA.length, 0);
    timingSafeEqual(bufA, dummy); // deliberate discard
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

// ─── 미들웨어 ────────────────────────────────────────────────────────────────

export function internalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn({ path: req.path, method: req.method }, 'Internal API: missing or malformed Authorization header');
    const err = InternalApiErrors.unauthorized('Authorization header is required: Bearer <token>');
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }

  const incomingToken = authHeader.slice('Bearer '.length);

  // 복수 토큰 중 하나라도 일치하면 인증 성공
  let authenticated = false;
  for (const validToken of VALID_TOKENS) {
    if (timingSafeEqual_str(incomingToken, validToken)) {
      authenticated = true;
      break;
    }
  }

  if (!authenticated) {
    logger.warn({ path: req.path, method: req.method }, 'Internal API: invalid Bearer token');
    const err = InternalApiErrors.unauthorized('Invalid Bearer token');
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }

  next();
}
