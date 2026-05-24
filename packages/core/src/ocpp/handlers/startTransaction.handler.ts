/**
 * packages/core/src/ocpp/handlers/startTransaction.handler.ts
 *
 * OCPP 1.6 §6.19 StartTransaction.req 핸들러.
 *
 * Phase 2-D 변경:
 *  - transaction.create/update + writeOutbox를 prisma.$transaction으로 원자성 보장
 *  - TransactionStarted 이벤트 발행 → Outbox Relay → Redis Stream → Portal Consumer
 *
 * chargeGoalQueue.add는 Portal 도메인이 아닌 Core 내부 잡이므로 유지.
 * partnerRepository import도 Core 내부에서만 사용하므로 현 구조 유지
 * (Phase 3 이관 전까지).
 */

import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import { chargeGoalQueue } from '@core/jobs/queues';
import { partnerRepository } from '@pvpentech/portal/repositories/partner.repository';
import { writeOutbox } from '../../outbox/outboxWriter';
import type { TransactionStartedPayload } from '@pvpentech/shared/types/events';

interface StartTransactionPayload {
  connectorId: number;
  idTag: string;
  meterStart: number;  // Wh
  timestamp: string;
}

export async function startTransactionHandler(
  stationId: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const p = payload as unknown as StartTransactionPayload;
  logger.info({ stationId, idTag: p.idTag, meterStart: p.meterStart }, 'StartTransaction received');

  // Try to find pending transaction by sessionId (idTag used as sessionId in RemoteStart)
  const transaction = await prisma.transaction.findFirst({
    where: {
      sessionId: p.idTag,
      stationId,
      status: 'Pending',
    },
  });

  // 정산 snapshot: StartTransaction 시점의 파트너 설정을 조회해 거래 행에 기록.
  // partner가 없는 경우(orphan station 등) 모든 snapshot은 null — 수동 정산만 가능.
  const partner = await partnerRepository.findByStationId(stationId);
  const settlementSnapshot = {
    marginRate:         partner?.marginRate         ?? null,
    settlementSchedule: partner?.settlementSchedule ?? null,
    settlementDay:      partner?.settlementDay       ?? null,
    settlementDayOfWeek:partner?.settlementDayOfWeek ?? null,
  };

  if (!transaction) {
    logger.warn({ stationId, idTag: p.idTag }, 'No pending transaction found for StartTransaction');
    // Create new transaction for RFID-initiated or unmatched starts.
    // ocppTransactionId 는 PK 와 동일하게 맞춰 StopTransaction 매칭이 정상 동작하도록 보장.

    const newTx = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          sessionId: `ocpp_${Date.now()}`,
          stationId,
          connectorId: p.connectorId,
          idTag: p.idTag,
          status: 'Active',
          meterStart: p.meterStart,
          timeStart: new Date(p.timestamp),
          ...settlementSnapshot,
        },
      });
      const updated = await tx.transaction.update({
        where: { id: created.id },
        data: { ocppTransactionId: created.id },
      });

      // siteId는 ChargingStation.siteId Logical FK 값 (Portal Consumer가 partnerId 매핑에 사용)
      const stationForSite = await tx.chargingStation.findUnique({
        where: { id: stationId },
        select: { siteId: true },
      });

      const outboxPayload: TransactionStartedPayload = {
        transactionId: updated.id,
        sessionId: updated.sessionId,
        stationId,
        connectorId: updated.connectorId,
        idTag: updated.idTag ?? undefined,
        meterStart: updated.meterStart,
        timeStart: updated.timeStart?.toISOString() ?? new Date().toISOString(),
        unitPriceVnd: updated.unitPriceVnd ?? undefined,
        marginRate: updated.marginRate != null ? String(updated.marginRate) : undefined,
        settlementSchedule: updated.settlementSchedule ?? undefined,
        settlementDay: updated.settlementDay ?? undefined,
        settlementDayOfWeek: updated.settlementDayOfWeek ?? undefined,
        siteId: stationForSite?.siteId ?? undefined,
      };

      await writeOutbox(tx, {
        eventType: 'TransactionStarted',
        aggregateType: 'Transaction',
        aggregateId: String(updated.id),
        payload: outboxPayload as unknown as Record<string, unknown>,
      });

      return updated;
    });

    return {
      transactionId: newTx.id,
      idTagInfo: { status: 'Accepted' },
    };
  }

  // 충전소 단가 조회 (amount 목표 계산에 사용)
  // TODO(Phase 3-D): site relation 제거됨 (Phase 3-B). siteId로 Portal ChargingSite 별도 조회 필요.
  // 임시: Core에서 단가 조회 불가 → 기본값 3500 VND/kWh 사용.
  const station = await prisma.chargingStation.findUnique({
    where: { id: stationId },
  });
  const unitPriceVnd = 3500; // TODO(Phase 3-D): Portal API로 siteId 기반 단가 조회

  // ─── 원자적 트랜잭션: DB 갱신 + Outbox 기록 ────────────────────────────────
  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        ocppTransactionId: transaction.id,
        status: 'Active',
        meterStart: p.meterStart,
        timeStart: new Date(p.timestamp),
        unitPriceVnd,
        // snapshot은 create 시점에 이미 설정된 경우(payment.service 경로)가 있지만,
        // RFID 직접 시작 등 미설정 경우를 위해 여기서도 채운다.
        ...settlementSnapshot,
      },
    });

    // siteId는 ChargingStation.siteId Logical FK 값 (Portal Consumer가 partnerId 매핑에 사용)
    const stationForSite2 = await tx.chargingStation.findUnique({
      where: { id: stationId },
      select: { siteId: true },
    });

    const outboxPayload: TransactionStartedPayload = {
      transactionId: transaction.id,
      sessionId: transaction.sessionId,
      stationId,
      connectorId: transaction.connectorId,
      idTag: transaction.idTag ?? undefined,
      meterStart: p.meterStart,
      timeStart: new Date(p.timestamp).toISOString(),
      unitPriceVnd,
      marginRate: settlementSnapshot.marginRate != null ? String(settlementSnapshot.marginRate) : undefined,
      settlementSchedule: settlementSnapshot.settlementSchedule ?? undefined,
      settlementDay: settlementSnapshot.settlementDay ?? undefined,
      settlementDayOfWeek: settlementSnapshot.settlementDayOfWeek ?? undefined,
      siteId: stationForSite2?.siteId ?? undefined,
    };

    await writeOutbox(tx, {
      eventType: 'TransactionStarted',
      aggregateType: 'Transaction',
      aggregateId: String(transaction.id),
      payload: outboxPayload as unknown as Record<string, unknown>,
    });
  });

  // chargeGoal job의 unitPriceVnd 업데이트 (pending job이 있는 경우)
  // 이 잡은 Core 내부 도메인이므로 트랜잭션 외부에서 별도 처리.
  if (transaction.goalType && transaction.goalValue) {
    await chargeGoalQueue.add(
      'goal-check',
      {
        sessionId: transaction.sessionId,
        goalType: transaction.goalType,
        goalValue: Number(transaction.goalValue),
        unitPriceVnd,
      },
      { delay: 60000, jobId: `goal-${transaction.sessionId}` }
    ).catch(() => {});
  }

  // Update connector status
  await prisma.connector.upsert({
    where: { stationId_connectorId: { stationId, connectorId: p.connectorId } },
    update: { currentStatus: 'Charging' },
    create: { stationId, connectorId: p.connectorId, currentStatus: 'Charging' },
  }).catch(() => {});

  logger.info({ stationId, sessionId: p.idTag, meterStart: p.meterStart }, 'Transaction started — TransactionStarted event queued via Outbox');

  return {
    transactionId: transaction.id,
    idTagInfo: { status: 'Accepted' },
  };
}
