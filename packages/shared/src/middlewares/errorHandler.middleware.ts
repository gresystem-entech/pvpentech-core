import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { logger } from '../config/logger';

export function errorHandlerMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Zod 유효성 검사 에러
  const t = typeof req.t === 'function' ? req.t.bind(req) : (key: string) => key;

  if (error instanceof ZodError) {
    const firstError = error.errors[0];
    const message = t('error:validationFailed') || (firstError?.message ?? '입력값이 올바르지 않습니다.');
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
      },
    });
    return;
  }

  // 2. 커스텀 AppError (비즈니스 로직 에러)
  if (error instanceof AppError) {
    const logLevel = error.statusCode >= 500 ? 'error' : 'warn';
    logger[logLevel]({ error, path: req.path }, `AppError: ${error.code}`);

    // messageKey가 있으면 Accept-Language 기반 번역, 없으면 기본 메시지 사용
    const message = error.messageKey ? t(error.messageKey) : error.message;

    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message,
      },
    });
    return;
  }

  // 3. 예상치 못한 에러
  logger.error({ error, path: req.path, method: req.method }, 'Unhandled error');

  const message = t('error:internalServer');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  });
}
