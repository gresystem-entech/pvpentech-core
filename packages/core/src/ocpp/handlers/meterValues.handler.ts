/**
 * packages/core/src/ocpp/handlers/meterValues.handler.ts
 *
 * OCPP 1.6 §6.9 MeterValues.req 핸들러.
 *
 * Phase 2-D 변경:
 *  - MeterValueUpdate 이벤트 Outbox 기록 기본 골격 추가.
 *  - 현재는 모든 MeterValues 메시지마다 발행 (throttle 미구현).
 *  - TODO(Phase 4): 1분에 한 번 또는 의미 있는 kWh 변화 시만 발행하도록 throttle 최적화.
 *
 * 페이로드:
 *  - Energy.Active.Import.Register measurand의 최신 값을 currentKwh로 변환.
 *  - Power.Active.Import measurand의 최신 값을 currentW로 변환 (있을 경우).
 */

import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import { writeOutbox } from '../../outbox/outboxWriter';
import type { MeterValueUpdatePayload } from '@pvpentech/shared/types/events';

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

interface MeterValuesPayload {
  connectorId: number;
  transactionId?: number;
  meterValue: MeterValueEntry[];
}

export async function meterValuesHandler(
  stationId: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const p = payload as unknown as MeterValuesPayload;
  logger.debug({ stationId, connectorId: p.connectorId }, 'MeterValues received');

  // Find active transaction
  const transaction = await prisma.transaction.findFirst({
    where: {
      stationId,
      connectorId: p.connectorId,
      status: 'Active',
    },
  });

  if (!transaction) {
    logger.warn({ stationId, connectorId: p.connectorId }, 'No active transaction for MeterValues');
    return {};
  }

  // Save each meter value (OCPP 1.6 SampledValue 전체 필드)
  const meterValueRecords = [];
  let latestEnergyWh: number | undefined;
  let latestPowerW: number | undefined;

  for (const mv of p.meterValue) {
    for (const sv of mv.sampledValue) {
      const measurand = sv.measurand || 'Energy.Active.Import.Register';
      const numericValue = parseFloat(sv.value) || 0;

      meterValueRecords.push({
        transactionId: transaction.id,
        timestamp: new Date(mv.timestamp),
        measurand,
        value: numericValue,
        unit: sv.unit || 'Wh',
        phase: sv.phase || null,
        context: sv.context || null,    // Sample.Periodic / Transaction.Begin/End / Trigger / ...
        format: sv.format || null,      // Raw / SignedData
        location: sv.location || null,  // Body / Cable / EV / Inlet / Outlet
      });

      // 최신 에너지 / 파워 값 추출 (Outbox 페이로드용)
      if (measurand === 'Energy.Active.Import.Register') {
        latestEnergyWh = numericValue;
      } else if (measurand === 'Power.Active.Import') {
        latestPowerW = numericValue;
      }
    }
  }

  if (meterValueRecords.length > 0) {
    await prisma.meterValue.createMany({ data: meterValueRecords });
  }

  // ─── MeterValueUpdate 이벤트 Outbox 기록 ────────────────────────────────────
  // TODO(Phase 4): throttle 로직 추가 — 1분 간격 또는 의미 있는 kWh 변화 시만 발행.
  // 현재는 모든 MeterValues 메시지마다 발행 (기본 골격).
  if (meterValueRecords.length > 0) {
    try {
      const currentKwh = latestEnergyWh != null
        ? Math.max(0, (latestEnergyWh - transaction.meterStart) / 1000)
        : undefined;

      const meterPayload: MeterValueUpdatePayload = {
        transactionId: transaction.id,
        sessionId: transaction.sessionId,
        stationId,
        currentKwh: currentKwh != null ? Math.round(currentKwh * 1000) / 1000 : undefined,
        currentW: latestPowerW,
      };

      await prisma.$transaction(async (tx) => {
        await writeOutbox(tx, {
          eventType: 'MeterValueUpdate',
          aggregateType: 'Transaction',
          aggregateId: String(transaction.id),
          payload: meterPayload as unknown as Record<string, unknown>,
        });
      });
    } catch (err) {
      // MeterValueUpdate Outbox 실패는 치명적이지 않음 — 로그만 남기고 계속
      logger.warn({ stationId, transactionId: transaction.id, err }, 'Failed to write MeterValueUpdate outbox');
    }
  }

  return {};
}
