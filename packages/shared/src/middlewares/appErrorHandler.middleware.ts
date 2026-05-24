import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors';
import { logger } from '../config/logger';

// 모바일 앱 API 전용 에러 핸들러 (기존 스펙 호환 + 다국어)
export function appErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const t = typeof req.t === 'function' ? req.t.bind(req) : (key: string) => key;

  if (error instanceof AppError) {
    // messageKey가 있으면 Accept-Language 기반 번역 적용
    const detail = error.messageKey ? t(error.messageKey) : error.message;

    res.status(error.statusCode).json({ detail });
    return;
  }

  logger.error({ error, path: req.path }, 'Unhandled error in app API');
  const detail = t('error:internalServer');
  res.status(500).json({ detail });
}
