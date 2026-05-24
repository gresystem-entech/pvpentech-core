import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import i18nextMiddleware from 'i18next-http-middleware';
import { i18n } from '../i18n';
import { env } from '../config/env';
import { errorHandlerMiddleware } from './errorHandler.middleware';

export * from './errorHandler.middleware';
export * from './appErrorHandler.middleware';
export * from './rateLimiter.middleware';

/**
 * 모든 Express 앱에 공통으로 적용할 미들웨어를 일괄 등록한다.
 * core-server, portal-server, legacy server 세 진입점이 모두 이 함수를 호출하여
 * 동일한 보안/압축/직렬화/i18n 설정을 공유한다.
 *
 * @param app - Express Application 인스턴스
 * @param opts.enableStaticFiles - public / webapp 정적 파일 서빙 여부 (portal-server, legacy server 에서 true)
 */
export function applyCommonMiddlewares(
  app: Application,
  opts: { enableStaticFiles?: boolean } = {}
): void {
  // Trust reverse proxy (nginx) — rate-limiter IP 감지에 필요
  app.set('trust proxy', 1);

  // 보안 헤더 (CSP는 portal 정적 파일 서빙 때문에 비활성화)
  app.use(helmet({ contentSecurityPolicy: false }));

  // 정적 파일 서빙 (portal-server / legacy server 전용)
  if (opts.enableStaticFiles) {
    const path = require('path') as typeof import('path');
    app.use(express.static(path.join(process.cwd(), 'public')));
    app.use('/app', express.static(path.join(process.cwd(), 'webapp')));
    app.get('/app', (_req: Request, res: Response) => {
      res.sendFile(path.join(process.cwd(), 'webapp', 'index.html'));
    });
    app.get('/', (_req: Request, res: Response) => {
      res.redirect('/portal/login.html');
    });
  }

  // CORS
  app.use(
    cors({
      origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((o) => o.trim()) : '*',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
    })
  );

  // 압축
  app.use(compression());

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // i18n 미들웨어 (라우트보다 먼저 등록)
  app.use(i18nextMiddleware.handle(i18n));
}

/**
 * Express 앱에 공통 에러 핸들러를 마지막 미들웨어로 등록한다.
 * 반드시 모든 라우트 등록이 끝난 뒤에 호출해야 한다.
 */
export function applyErrorHandler(app: Application): void {
  // 404 핸들러
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  // 전역 에러 핸들러 (반드시 마지막)
  app.use(
    errorHandlerMiddleware as unknown as (
      err: Error,
      req: Request,
      res: Response,
      next: NextFunction
    ) => void
  );
}
