/**
 * packages/core/src/outbox/streamPublisher.ts
 *
 * Redis Stream Publisher — OutboxRelay가 호출하여 이벤트를 csms:core:events에 기록.
 * ioredis 사용. MAXLEN ~ 1_000_000 으로 트리밍.
 */

import { redis } from '@pvpentech/shared/config/redis';
import { logger } from '@pvpentech/shared/config/logger';

export const STREAM_KEY = 'csms:core:events';
const DLQ_KEY = 'csms:core:events:dlq';
const MAX_LEN = 1_000_000; // approx trim (~)

export interface PublishableEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;       // ISO8601
  aggregateType?: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
}

/**
 * Redis Stream에 이벤트를 발행한다.
 * XADD csms:core:events MAXLEN ~ 1000000 * ...fields
 *
 * @returns Redis Stream entry ID (예: "1716548400000-0")
 */
export async function publishEventToStream(event: PublishableEvent): Promise<string> {
  const id = await (redis as import('ioredis').Redis).xadd(
    STREAM_KEY,
    'MAXLEN', '~', String(MAX_LEN),
    '*',
    'eventId', event.eventId,
    'eventType', event.eventType,
    'occurredAt', event.occurredAt,
    'aggregateType', event.aggregateType ?? '',
    'aggregateId', event.aggregateId ?? '',
    'payload', JSON.stringify(event.payload),
  );
  logger.debug(
    { streamId: id, eventId: event.eventId, eventType: event.eventType },
    '[StreamPublisher] event published',
  );
  return id ?? '';
}

/**
 * 최대 재시도 초과 이벤트를 Dead Letter Queue Stream에 이동.
 * DLQ Key: csms:core:events:dlq
 */
export async function moveToDeadLetter(event: PublishableEvent, reason: string): Promise<void> {
  await (redis as import('ioredis').Redis).xadd(
    DLQ_KEY,
    '*',
    'eventId', event.eventId,
    'eventType', event.eventType,
    'reason', reason,
    'occurredAt', event.occurredAt,
    'payload', JSON.stringify(event.payload),
  );
  logger.warn(
    { eventId: event.eventId, eventType: event.eventType, reason },
    '[StreamPublisher] event moved to DLQ',
  );
}
