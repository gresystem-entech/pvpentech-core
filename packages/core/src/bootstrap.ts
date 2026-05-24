/**
 * packages/core/src/bootstrap.ts
 *
 * Core 인프라 부팅 함수 — OCPP WebSocket, Outbox Relay, Core BullMQ Jobs.
 * apps/core-server 와 apps/server (legacy) 두 진입점이 이 함수를 공유한다.
 */

import http from 'http';
import { logger } from '@pvpentech/shared/config/logger';
import { bullmqRedis } from '@pvpentech/shared/config/redis';
import { Job, Worker } from 'bullmq';
import { initOcppWebSocketServer } from './ocpp/server';
import { startOutboxRelay, stopOutboxRelay } from './outbox';
import {
  startOcppCommandSweeper,
  stopOcppCommandSweeper,
} from './jobs/schedulers/ocppCommandSweeper.scheduler';
import { sessionTimeoutProcessor } from './jobs/processors/sessionTimeout.processor';
import { ocppLogCleanupProcessor } from './jobs/processors/ocppLogCleanup.processor';

export interface CoreInfraHandle {
  /** 기동한 HTTP 서버 (OCPP WebSocket + Core REST 공유) */
  httpServer: http.Server;
  /** Graceful shutdown — HTTP 서버 닫기 + relay/jobs 정지 */
  shutdown: () => Promise<void>;
}

let coreWorkers: Worker[] = [];

/**
 * Core 인프라를 부팅하고 handle 을 반환한다.
 *
 * @param httpServer - 이미 생성된 http.Server (Express app 을 래핑한 것)
 *                    OCPP WebSocket 서버가 이 서버에 attach 된다.
 */
export async function setupCoreInfra(httpServer: http.Server): Promise<CoreInfraHandle> {
  // OCPP WebSocket 서버를 HTTP 서버에 attach
  initOcppWebSocketServer(httpServer);
  logger.info('[Core] OCPP WebSocket server attached');

  // Outbox Relay 기동 (Core 발행 이벤트 → Redis Stream)
  startOutboxRelay();
  logger.info('[Core] Outbox relay started');

  // OCPP 명령 sweeper (부팅 cleanup + 주기 stale pending 처리)
  await startOcppCommandSweeper();
  logger.info('[Core] OCPP command sweeper started');

  // Core BullMQ Workers 기동
  await startCoreJobWorkers();

  const shutdown = async (): Promise<void> => {
    logger.info('[Core] Shutting down infrastructure...');
    stopOcppCommandSweeper();
    stopOutboxRelay();
    await stopCoreJobWorkers();
    logger.info('[Core] Infrastructure shutdown complete');
  };

  return { httpServer, shutdown };
}

async function startCoreJobWorkers(): Promise<void> {
  const connection = bullmqRedis;

  // Session timeout worker (Core 측 충전 세션 타임아웃 처리)
  const sessionTimeoutWorker = new Worker(
    'charge-goal',
    async (job: Job) => {
      if (job.data?.type === 'sessionTimeout') {
        await sessionTimeoutProcessor();
      }
      // chargeGoal 타입은 portal worker 가 처리 — 여기서는 무시
    },
    { connection, concurrency: 5 }
  );

  sessionTimeoutWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, '[Core] sessionTimeout job failed');
  });

  // OCPP log cleanup worker
  const cleanupWorker = new Worker(
    'cleanup',
    async (job: Job) => {
      if (job.data?.type === 'ocppLogCleanup') {
        await ocppLogCleanupProcessor();
      }
    },
    { connection, concurrency: 1 }
  );

  cleanupWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, '[Core] cleanup job failed');
  });

  coreWorkers = [sessionTimeoutWorker, cleanupWorker];
  logger.info('[Core] BullMQ workers started');
}

async function stopCoreJobWorkers(): Promise<void> {
  await Promise.all(coreWorkers.map((w) => w.close()));
  coreWorkers = [];
  logger.info('[Core] BullMQ workers stopped');
}
