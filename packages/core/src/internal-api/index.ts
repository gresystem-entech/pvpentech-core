/**
 * Internal API 통합 라우터 (Phase 2-B, B10)
 *
 * Portal → Core 서비스 간 HTTP 호출 엔드포인트.
 * 마운트 포인트: /api/internal/v1
 *
 * 모든 요청:
 *  1. internalAuthMiddleware — Bearer 토큰 검증
 *  2. idempotencyMiddleware — Idempotency-Key 헤더 처리
 *  3. 라우트별 핸들러
 *
 * 에러 응답 형식: { error: { code, message } }
 * (기존 errorHandlerMiddleware가 { success: false, error: { code, message } } 형식으로 처리)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { internalAuthMiddleware } from './auth.middleware';
import { idempotencyMiddleware } from './idempotency.middleware';
import stationsRouter from './routes/stations.routes';
import commandsRouter from './routes/commands.routes';
import sessionsRouter from './routes/sessions.routes';
import firmwareRouter, { stationFirmwareRouter } from './routes/firmware.routes';
import diagnosticsRouter from './routes/diagnostics.routes';
import { provisioningRouter, manufacturersRouter } from './routes/provisioning.routes';
import idTokensRouter from './routes/idTokens.routes';
import { InternalApiError } from '@pvpentech/shared/errors/internalApiErrors';
import { logger } from '@pvpentech/shared/config/logger';

export function createInternalApiRouter(): Router {
  const router = Router();

  // ─── 글로벌 미들웨어 ────────────────────────────────────────────────────────
  router.use(internalAuthMiddleware);
  router.use(idempotencyMiddleware);

  // ─── 라우트 마운트 ──────────────────────────────────────────────────────────

  // GET /stations, /stations/:id, /stations/:id/connection, /connectors, /ocpp-messages, /command-results
  router.use('/stations', stationsRouter);

  // POST /stations/:stationId/commands/*
  router.use('/stations', commandsRouter);

  // POST /stations/:stationId/firmware/update (station-scoped)
  router.use('/stations', stationFirmwareRouter);

  // POST /stations/:stationId/diagnostics, GET /stations/:stationId/diagnostics
  // GET/PUT /stations/:stationId/config/*
  router.use('/stations', diagnosticsRouter);

  // POST/GET /sessions/start, POST /sessions/:sessionId/stop
  router.use('/sessions', sessionsRouter);

  // POST/GET /firmware (firmware master), /firmware/campaigns/*
  router.use('/firmware', firmwareRouter);

  // GET/POST /provisioning, PUT /provisioning/:id/reject
  router.use('/provisioning', provisioningRouter);

  // GET/POST /manufacturers
  router.use('/manufacturers', manufacturersRouter);

  // GET/POST/PUT/DELETE /id-tokens (Phase 3-D: IdToken CRUD for Portal access)
  router.use('/id-tokens', idTokensRouter);

  // ─── Internal API 전용 에러 핸들러 ─────────────────────────────────────────
  // InternalApiError는 { error: { code, message } } 형식으로 응답
  // AppError(기존 체계)는 errorHandlerMiddleware가 처리
  router.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof InternalApiError) {
      logger.warn(
        { code: err.code, path: req.path, method: req.method },
        `InternalApiError: ${err.code}`,
      );
      res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
      return;
    }
    // 다른 에러는 상위 errorHandlerMiddleware로 위임
    next(err);
  });

  return router;
}

// 타입 exports
export type { InternalApiErrorCode } from '@pvpentech/shared/errors/internalApiErrors';
export { InternalApiError, InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';
