/**
 * apps/core-server/src/index.ts
 *
 * Core 전용 프로세스 엔트리 포인트.
 * 프로덕션 환경에서 Core 서버만 단독으로 기동할 때 사용한다.
 *
 * 기동 순서:
 *   1. DB / Redis 연결 확인
 *   2. i18n 초기화
 *   3. bootstrapCore() — Core HTTP 서버 + OCPP WS + Outbox Relay + Jobs
 *   4. SIGTERM / SIGINT 핸들러 등록
 */

import { env } from '@pvpentech/shared/config/env';
import { logger } from '@pvpentech/shared/config/logger';
// prismaCore.$disconnect() 는 내부적으로 단일 PrismaClient 인스턴스를 종료한다.
// prismaCore / prismaPortal 이 같은 인스턴스를 공유(접근 A)하므로 한 번 호출로 충분.
import { prisma, prismaCore } from '@pvpentech/shared/config/database';
import { redis } from '@pvpentech/shared/config/redis';
import { initI18n } from '@pvpentech/shared/i18n';
import { bootstrapCore } from './bootstrap';

async function main(): Promise<void> {
  // 인프라 연결 확인
  await prisma.$connect();
  logger.info('[Core] PostgreSQL connected');

  await redis.ping();
  logger.info('[Core] Redis connected');

  await initI18n();
  logger.info('[Core] i18n initialized');

  const port = env.CORE_PORT;
  const { shutdown } = await bootstrapCore(port);

  const onShutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, '[Core] Shutdown signal received');
    try {
      await shutdown();
      await prismaCore.$disconnect(); // 단일 인스턴스 종료 (prismaPortal도 동일 인스턴스)
      if (redis.status === 'ready' || redis.status === 'connect') {
        await redis.quit();
      }
      logger.info('[Core] Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, '[Core] Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => onShutdown('SIGTERM'));
  process.on('SIGINT', () => onShutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, '[Core] Uncaught exception — shutting down');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, '[Core] Unhandled promise rejection — shutting down');
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[Core] Failed to start:', err);
  process.exit(1);
});
