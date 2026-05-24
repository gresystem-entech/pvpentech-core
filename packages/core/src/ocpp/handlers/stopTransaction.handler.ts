/**
 * packages/core/src/ocpp/handlers/stopTransaction.handler.ts
 *
 * OCPP 1.6 §6.20 StopTransaction.req 핸들러.
 *
 * Phase 2-D 변경:
 *  - refundService.createFromTransaction 직접 호출 → 제거
 *  - postChargeBillingQueue.add 직접 호출 → 제거
 *  - transaction.update + writeOutbox를 prisma.$transaction으로 원자성 보장
 *  - TransactionStopped 이벤트 발행 → Outbox Relay → Redis Stream → Portal Consumer
 *
 * 이후 흐름:
 *  Portal transactionStopped.handler.ts 가 TransactionStopped를 소비하여
 *  refundService + postChargeBillingQueue를 처리한다.
 */

import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import { writeOutbox } from '../../outbox/outboxWriter';
import type { TransactionStoppedPayload } from '@pvpentech/shared/types/events';

interface SampledValue {
  value: string;
  measurand?: string;
  unit?: string;
  phase?: string;
  context?: string;
  format?: string;
  location?: string;
}

interface MeterValueEntry {
  timestamp: string;
  sampledValue: SampledValue[];
}

interface StopTransactionPayload {
  transactionId: number;
  meterStop: number;
  timestamp: string;
  reason?: string;
  idTag?: string;
  transactionData?: MeterValueEntry[]; // OCPP 1.6 §6.20 — 종료 시 누적 측정값
}

export async function stopTransactionHandler(
  stationId: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const p = payload as unknown as StopTransactionPayload;
  logger.info({ stationId, transactionId: p.transactionId, meterStop: p.meterStop }, 'StopTransaction received');

  // Find transaction by OCPP transaction ID
  const transaction = await prisma.transaction.findFirst({
    where: {
      ocppTransactionId: p.transactionId,
      stationId,
    },
    include: { station: true },
  });

  if (!transaction) {
    logger.warn({ stationId, transactionId: p.transactionId }, 'Transaction not found for StopTransaction');
    return { idTagInfo: { status: 'Accepted' } };
  }

  // TODO(Phase 3-D): site relation 제거됨 (Phase 3-B). siteId로 Portal ChargingSite 별도 조회 필요.
  // 임시: unitPriceVnd가 Transaction에 저장돼 있으면 사용, 없으면 기본값 사용.
  const unitPrice = transaction.unitPriceVnd ?? 3500;

  const meterStart = transaction.meterStart;
  const meterStop = p.meterStop;
  const totalWh = Math.max(0, meterStop - meterStart);
  const totalKwh = totalWh / 1000;
  const costVnd = Math.floor(totalKwh * unitPrice);

  const stopReason = p.reason ?? null;
  const timeEnd = new Date(p.timestamp);

  // ─── 원자적 트랜잭션: DB 갱신 + Outbox 기록 ────────────────────────────────
  await prisma.$transaction(async (tx) => {
    const updatedTransaction = await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'Stopped',
        meterEnd: p.meterStop,
        timeEnd,
        costVnd,
        unitPriceVnd: unitPrice,
        failReason: stopReason !== 'Local' && stopReason !== 'Remote' ? stopReason : null,
      },
    });

    const outboxPayload: TransactionStoppedPayload = {
      transactionId: updatedTransaction.id,
      sessionId: updatedTransaction.sessionId,
      stationId,
      meterStart: updatedTransaction.meterStart,
      meterStop: p.meterStop,
      totalKwh,
      costVnd: updatedTransaction.costVnd ?? undefined,
      unitPriceVnd: updatedTransaction.unitPriceVnd ?? undefined,
      timeStart: updatedTransaction.timeStart?.toISOString() ?? new Date().toISOString(),
      timeEnd: updatedTransaction.timeEnd?.toISOString() ?? timeEnd.toISOString(),
      reason: stopReason ?? undefined,
    };

    await writeOutbox(tx, {
      eventType: 'TransactionStopped',
      aggregateType: 'Transaction',
      aggregateId: String(updatedTransaction.id),
      payload: outboxPayload as unknown as Record<string, unknown>,
    });
  });

  // ─── 트랜잭션 외 부수 효과 ───────────────────────────────────────────────────

  // OCPP 1.6 §6.20: transactionData가 있으면 MeterValue로 함께 저장.
  // 일부 충전기가 종료 시 마지막 측정 묶음을 여기에 담아 보내므로 누락 시 마지막 충전량 손실 가능.
  if (Array.isArray(p.transactionData) && p.transactionData.length > 0) {
    const records: Array<{
      transactionId: number;
      timestamp: Date;
      measurand: string;
      value: number;
      unit: string | null;
      phase: string | null;
      context: string | null;
      format: string | null;
      location: string | null;
    }> = [];
    for (const mv of p.transactionData) {
      for (const sv of mv.sampledValue) {
        records.push({
          transactionId: transaction.id,
          timestamp: new Date(mv.timestamp),
          measurand: sv.measurand || 'Energy.Active.Import.Register',
          value: parseFloat(sv.value) || 0,
          unit: sv.unit ?? null,
          phase: sv.phase ?? null,
          context: sv.context ?? null,
          format: sv.format ?? null,
          location: sv.location ?? null,
        });
      }
    }
    if (records.length > 0) {
      await prisma.meterValue.createMany({ data: records }).catch((err) => {
        logger.warn({ stationId, transactionId: p.transactionId, err }, 'Failed to persist transactionData');
      });
      logger.info({ stationId, transactionId: p.transactionId, count: records.length }, 'transactionData persisted');
    }
  }

  // Update connector status to Available
  await prisma.connector.updateMany({
    where: { stationId, connectorId: transaction.connectorId },
    data: { currentStatus: 'Available' },
  }).catch(() => {});

  logger.info({ stationId, transactionId: p.transactionId, totalKwh, costVnd }, 'Transaction stopped — TransactionStopped event queued via Outbox');

  return { idTagInfo: { status: 'Accepted' } };
}
