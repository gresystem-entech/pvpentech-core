/**
 * apps/server/src/index.ts
 *
 * Legacy 통합 진입점 — Core 와 Portal 을 단일 프로세스에서 기동한다.
 * 용도: 개발 환경, 통합 테스트, 마이그레이션 기간 fallback.
 *
 * Phase 2-E 이후 구조:
 *  - Core  → apps/core-server/src/bootstrap.ts  의 bootstrapCore()  위임
 *  - Portal → apps/portal-server/src/bootstrap.ts 의 bootstrapPortal() 위임
 *  - 각각 CORE_PORT(3001), PORTAL_PORT(3002) 에서 개별 listen
 *
 * 기동 순서:
 *   1. DB / Redis 연결 확인
 *   2. i18n 초기화
 *   3. Core + Portal 동시 부팅 (Promise.all)
 *   4. SIGTERM / SIGINT graceful shutdown
 */

import { env } from '@pvpentech/shared/config/env';
import { logger } from '@pvpentech/shared/config/logger';
import { prisma } from '@pvpentech/shared/config/database';
import { redis } from '@pvpentech/shared/config/redis';
import { initI18n } from '@pvpentech/shared/i18n';
import { bootstrapCore } from '../../../apps/core-server/src/bootstrap';
import { bootstrapPortal } from '../../../apps/portal-server/src/bootstrap';

async function bootstrap(): Promise<void> {
  // 인프라 연결 확인
  await prisma.$connect();
  logger.info('PostgreSQL connected');

  await redis.ping();
  logger.info('Redis connected');

  await initI18n();
  logger.info('i18n initialized');

  const corePort = env.CORE_PORT;
  const portalPort = env.PORTAL_PORT;

  logger.info({ corePort, portalPort }, 'Starting Core + Portal in single process (legacy mode)');

  // Core 와 Portal 을 동시에 부팅
  const [coreHandle, portalHandle] = await Promise.all([
    bootstrapCore(corePort),
    bootstrapPortal(portalPort),
  ]);

  logger.info(
    { corePort, portalPort },
    'Pvpentech CSMS started (legacy mode — Core + Portal in single process)'
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');
    try {
      await Promise.all([coreHandle.shutdown(), portalHandle.shutdown()]);
      await prisma.$disconnect();
      if (redis.status === 'ready' || redis.status === 'connect') {
        await redis.quit();
      }
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection — shutting down');
    process.exit(1);
  });

  // Force exit after 30s on shutdown
  process.once('SIGTERM', () => {
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000).unref();
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
