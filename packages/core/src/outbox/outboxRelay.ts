/**
 * packages/core/src/outbox/outboxRelay.ts
 *
 * Outbox Relay — 주기적으로 publishedAt IS NULL인 OutboxEvent를 조회하여
 * Redis Stream으로 발행하는 폴링 루프.
 *
 * 단일 인스턴스 운영(D-2)이므로 분산락 불필요.
 * running 플래그로 동일 틱 내 중복 실행 방지.
 */

import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import {
  publishEventToStream,
  moveToDeadLetter,
  type PublishableEvent,
} from './streamPublisher';

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 2_000;
const MAX_ATTEMPTS = 10;

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Outbox Relay를 시작한다.
 * 이미 실행 중이면 중복 시작하지 않는다.
 */
export function startOutboxRelay(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  logger.info(
    { pollMs: POLL_INTERVAL_MS, batch: BATCH_SIZE, maxAttempts: MAX_ATTEMPTS },
    '[OutboxRelay] started',
  );
}

/**
 * Outbox Relay를 정지한다.
 */
export function stopOutboxRelay(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  logger.info('[OutboxRelay] stopped');
}

/**
 * 단일 폴링 틱.
 * - publishedAt IS NULL && attempts < MAX_ATTEMPTS 인 이벤트 최대 BATCH_SIZE건 조회
 * - 각 이벤트를 Redis Stream 발행 시도
 * - 성공: publishedAt = now() 갱신
 * - 실패: attempts +1, lastError 갱신. MAX_ATTEMPTS 도달 시 DLQ로 이동
 */
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const pending = await prisma.outboxEvent.findMany({
      where: {
        publishedAt: null,
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });

    if (pending.length === 0) return;

    logger.debug({ count: pending.length }, '[OutboxRelay] tick: processing events');

    for (const ev of pending) {
      const publishable: PublishableEvent = {
        eventId: ev.eventId,
        eventType: ev.eventType,
        occurredAt: ev.occurredAt.toISOString(),
        aggregateType: ev.aggregateType ?? undefined,
        aggregateId: ev.aggregateId ?? undefined,
        payload: ev.payload as Record<string, unknown>,
      };

      try {
        await publishEventToStream(publishable);
        await prisma.outboxEvent.update({
          where: { id: ev.id },
          data: { publishedAt: new Date(), lastError: null },
        });
      } catch (err) {
        const nextAttempts = ev.attempts + 1;
        const reason = err instanceof Error ? err.message : String(err);

        if (nextAttempts >= MAX_ATTEMPTS) {
          // DLQ로 이동 후 publishedAt을 현재 시각으로 set — 이후 릴레이 조회 제외
          try {
            await moveToDeadLetter(publishable, reason);
          } catch (dlqErr) {
            logger.error(
              { err: dlqErr, eventId: ev.eventId },
              '[OutboxRelay] failed to move to DLQ',
            );
          }
          await prisma.outboxEvent.update({
            where: { id: ev.id },
            data: {
              attempts: nextAttempts,
              lastError: reason,
              publishedAt: new Date(), // 재시도 제외를 위해 set
            },
          });
          logger.error(
            { eventId: ev.eventId, eventType: ev.eventType, attempts: nextAttempts, reason },
            '[OutboxRelay] max attempts reached — moved to DLQ',
          );
        } else {
          await prisma.outboxEvent.update({
            where: { id: ev.id },
            data: { attempts: nextAttempts, lastError: reason },
          });
          logger.warn(
            { eventId: ev.eventId, eventType: ev.eventType, attempts: nextAttempts, reason },
            '[OutboxRelay] publish failed, will retry',
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err }, '[OutboxRelay] tick error');
  } finally {
    running = false;
  }
}
