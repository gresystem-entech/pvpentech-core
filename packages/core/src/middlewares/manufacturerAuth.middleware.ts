/**
 * packages/core/src/middlewares/manufacturerAuth.middleware.ts
 *
 * x-token / x-channel 헤더 기반 제조사 인증 미들웨어 (v2.0).
 *
 * Phase 4-B: @pvpentech/portal 의존성 제거 — Core 내부 manufacturerRepository 직접 사용.
 * Portal 리포의 middlewares/manufacturerAuth.middleware.ts 와 로직 동일하나
 * coreApiClient 대신 prismaCore 직접 접근.
 */
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { manufacturerRepository } from '../repositories/manufacturer.repository';
import { logger } from '@pvpentech/shared/config/logger';

/**
 * x-token / x-channel 헤더 기반 제조사 인증 미들웨어 (v2.0)
 *
 * 검증 흐름:
 *   1. x-token, x-channel 헤더 존재 확인 → 없으면 401
 *   2. x-channel로 Manufacturer DB 조회 → 없으면 401
 *   3. bcrypt.compare(x-token, tokenHash) → 불일치 시 401
 *   4. manufacturer.isActive === true → false이면 401
 *   5. 통과: req.manufacturer에 제조사 객체 주입 후 next()
 */
export async function manufacturerAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const xToken = req.headers['x-token'] as string | undefined;
  const xChannel = req.headers['x-channel'] as string | undefined;

  if (!xToken || !xChannel) {
    res.status(401).json({
      code: 401,
      status: 'Unauthorized',
      message: req.t ? req.t('provisioning:authHeaderMissing') : '인증 헤더가 없습니다.',
      errors: null,
    });
    return;
  }

  try {
    const manufacturer = await manufacturerRepository.findByChannelId(xChannel);

    if (!manufacturer) {
      logger.warn({ xChannel }, 'manufacturerAuth: unknown channelId');
      res.status(401).json({
        code: 401,
        status: 'Unauthorized',
        message: req.t ? req.t('provisioning:authFailed') : '인증에 실패하였습니다.',
        errors: null,
      });
      return;
    }

    if (!manufacturer.isActive) {
      logger.warn({ xChannel, id: manufacturer.id }, 'manufacturerAuth: inactive manufacturer');
      res.status(401).json({
        code: 401,
        status: 'Unauthorized',
        message: req.t ? req.t('provisioning:authFailed') : '인증에 실패하였습니다.',
        errors: null,
      });
      return;
    }

    const tokenHash = manufacturer.tokenHash ?? '';
    const isValid = tokenHash ? await bcrypt.compare(xToken, tokenHash) : false;
    if (!isValid) {
      logger.warn({ xChannel, id: manufacturer.id }, 'manufacturerAuth: token mismatch');
      res.status(401).json({
        code: 401,
        status: 'Unauthorized',
        message: req.t ? req.t('provisioning:authFailed') : '인증에 실패하였습니다.',
        errors: null,
      });
      return;
    }

    // 미들웨어 통과: req에 manufacturer 정보 주입
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.manufacturer = manufacturer as any;
    next();
  } catch (err) {
    logger.error({ err }, 'manufacturerAuth: unexpected error');
    res.status(500).json({
      code: 500,
      status: 'Internal Server Error',
      message: '서버 내부 오류가 발생하였습니다.',
      errors: null,
    });
  }
}
