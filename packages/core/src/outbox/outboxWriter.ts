/**
 * packages/core/src/outbox/outboxWriter.ts
 *
 * Outbox Writer Helper — 비즈니스 트랜잭션과 동일 Prisma tx 내에서 OutboxEvent를 기록.
 * 비즈니스 데이터 변경과 원자성을 보장한다 (Transactional Outbox 패턴).
 */

import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import type { CsmsEventType } from '@pvpentech/shared/types/events';

export interface OutboxEventInput {
  /** 이벤트 타입 (이벤트 카탈로그 6-2 기준) */
  eventType: CsmsEventType;
  /** 집합 타입 — "Transaction" | "Station" 등 (선택) */
  aggregateType?: string;
  /** 집합 식별자 — transactionId, stationId 등 (선택) */
  aggregateId?: string;
  /** 이벤트 본문 */
  payload: Record<string, unknown>;
}

/**
 * 트랜잭션 내에서 OutboxEvent를 기록한다.
 *
 * @param tx - Prisma 트랜잭션 클라이언트 (prisma.$transaction 콜백 인자)
 * @param input - 이벤트 입력 데이터
 * @returns 생성된 eventId (UUID v4)
 *
 * @example
 * await prisma.$transaction(async (tx) => {
 *   await tx.transaction.update({ ... });
 *   await writeOutbox(tx, {
 *     eventType: 'TransactionStopped',
 *     aggregateType: 'Transaction',
 *     aggregateId: String(transactionId),
 *     payload: { ... },
 *   });
 * });
 */
export async function writeOutbox(
  tx: Prisma.TransactionClient,
  input: OutboxEventInput,
): Promise<string> {
  const eventId = uuidv4();
  await tx.outboxEvent.create({
    data: {
      eventId,
      eventType: input.eventType,
      aggregateType: input.aggregateType ?? null,
      aggregateId: input.aggregateId ?? null,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });
  return eventId;
}
