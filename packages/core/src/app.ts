/**
 * packages/core/src/app.ts
 *
 * Core 전용 Express 앱 팩토리.
 * OCPP WebSocket 서버에 붙을 HTTP 서버를 위한 앱을 구성한다.
 *
 * 포함되는 라우트:
 *  - /api/internal/v1/*   (Core Internal API — Phase 2-B)
 *  - /firmware/:filename  (충전기 펌웨어 다운로드)
 *  - /auths               (충전기 프로비저닝 v2.0 — x-token/x-channel)
 *  - /provision           (모바일 프로비저닝)
 *  - /health              (헬스체크)
 */

import express, { Application, Request, Response } from 'express';
import { applyCommonMiddlewares, applyErrorHandler } from '@pvpentech/shared/middlewares';
import { createInternalApiRouter } from './internal-api/index';
import { firmwareController } from './controllers/firmware.controller';
import { ProvisionController } from './controllers/provision.controller';
import { provisionService } from './services/provision.service';
import { manufacturerAuth } from './middlewares/manufacturerAuth.middleware';
import { provisionRateLimiter } from '@pvpentech/shared/middlewares/rateLimiter.middleware';
import provisionRoutes from './routes/provision.routes';

export function createCoreApp(): Application {
  const app = express();

  // 공통 미들웨어 (보안 헤더, CORS, 압축, body parsing, i18n)
  // Core 서버는 정적 파일 서빙 불필요
  applyCommonMiddlewares(app, { enableStaticFiles: false });

  // 헬스체크 (인증 불필요)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'core', timestamp: new Date().toISOString() });
  });

  // Internal API (Phase 2-B) — Portal → Core 서비스 간 통신
  app.use('/api/internal/v1', createInternalApiRouter());

  // 충전기 측 펌웨어 다운로드
  app.get('/firmware/:filename', firmwareController.download);

  // 충전기 프로비저닝 v2.0 (x-token/x-channel 헤더 인증)
  const provisionController = new ProvisionController(provisionService);
  app.post('/auths', provisionRateLimiter, manufacturerAuth, provisionController.chargerAuth);

  // 모바일 프로비저닝 (공개, rate limited)
  app.use('/provision', provisionRoutes);

  // 404 + 전역 에러 핸들러 (반드시 라우트 등록 후)
  applyErrorHandler(app);

  return app;
}
