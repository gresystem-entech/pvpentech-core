/**
 * packages/core/src/ocpp/handlers/statusNotification.handler.ts
 *
 * OCPP 1.6 §6.21 StatusNotification.req 핸들러.
 *
 * Phase 2-D 변경:
 *  - 커넥터 상태 변경 시 ConnectorStatusChanged 이벤트 Outbox 기록 추가.
 *  - errorCode가 "NoError"가 아닌 경우 FaultRaised 이벤트 Outbox 기록.
 *  - 이전에 fault였다가 NoError(Available 등)가 되면 FaultCleared 이벤트 Outbox 기록.
 *  - connector DB 변경과 Outbox를 prisma.$transaction으로 원자성 보장.
 */

import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import { ConnectorStatus, StationStatus } from '@prisma/client';
import { writeOutbox } from '../../outbox/outboxWriter';
import type {
  ConnectorStatusChangedPayload,
  FaultRaisedPayload,
  FaultClearedPayload,
} from '@pvpentech/shared/types/events';

interface StatusNotificationPayload {
  connectorId: number;
  errorCode: string;
  status: string;
  timestamp?: string;
  info?: string;
  vendorId?: string;
  vendorErrorCode?: string;
}

// Statuses that require an offline log entry
const OFFLINE_STATUSES: StationStatus[] = ['Faulted', 'Inspecting', 'CommunicationFault', 'Unknown'];

export async function writeOfflineLog(stationId: string, status: StationStatus): Promise<void> {
  try {
    const station = await prisma.chargingStation.findUnique({
      where: { id: stationId },
      // TODO(Phase 3-D): site relation 제거됨 (Phase 3-B). partnerId는 Portal에서 siteId로 조회 필요.
      // 임시: siteId만 기록하고 partnerId는 null 처리.
      select: { siteId: true },
    });
    await prisma.offlineLog.create({
      data: {
        stationId,
        siteId: station?.siteId ?? null,
        partnerId: null, // TODO(Phase 3-D): Portal API로 siteId → partnerId 조회
        status,
      },
    });
  } catch (err) {
    logger.warn({ stationId, status, err }, 'Failed to write offline log');
  }
}

export async function statusNotificationHandler(
  stationId: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const p = payload as unknown as StatusNotificationPayload;
  logger.info({ stationId, connectorId: p.connectorId, status: p.status }, 'StatusNotification received');

  const ocppStatus = p.status;
  const connectorId = p.connectorId;

  // Map OCPP status to DB enum
  const validStatuses: ConnectorStatus[] = [
    'Available', 'Preparing', 'Charging', 'SuspendedEVSE',
    'SuspendedEV', 'Finishing', 'Reserved', 'Unavailable', 'Faulted'
  ];
  const connectorStatus = validStatuses.includes(ocppStatus as ConnectorStatus)
    ? (ocppStatus as ConnectorStatus)
    : 'Unavailable';

  // OCPP 1.6 부가 필드 — 모두 옵션. errorCode 는 NoError 값이면 null 로 정규화.
  const errorCode = p.errorCode && p.errorCode !== 'NoError' ? p.errorCode : null;
  const info = p.info ?? null;
  const vendorId = p.vendorId ?? null;
  const vendorErrorCode = p.vendorErrorCode ?? null;
  const statusTimestamp = p.timestamp ? new Date(p.timestamp) : new Date();

  if (connectorId === 0) {
    // Connector 0 = station-level status
    let stationStatus: StationStatus = 'Online';
    if (ocppStatus === 'Faulted') stationStatus = 'Faulted';

    await prisma.chargingStation.update({
      where: { id: stationId },
      data: { status: stationStatus },
    }).catch(() => {});

    // Write offline log if entering an offline-category state
    if (OFFLINE_STATUSES.includes(stationStatus)) {
      await writeOfflineLog(stationId, stationStatus);
    }
  } else {
    // ─── 원자적 트랜잭션: Connector 상태 변경 + Outbox 기록 ───────────────────

    // 이전 오류 상태 확인 (FaultCleared 감지용)
    const prevConnector = await prisma.connector.findUnique({
      where: { stationId_connectorId: { stationId, connectorId } },
      select: { errorCode: true },
    });
    const wasInFault = prevConnector?.errorCode != null;

    await prisma.$transaction(async (tx) => {
      // Upsert connector status with full OCPP fields
      await tx.connector.upsert({
        where: {
          stationId_connectorId: { stationId, connectorId },
        },
        update: {
          currentStatus: connectorStatus,
          errorCode,
          info,
          vendorId,
          vendorErrorCode,
          statusTimestamp,
        },
        create: {
          stationId,
          connectorId,
          currentStatus: connectorStatus,
          errorCode,
          info,
          vendorId,
          vendorErrorCode,
          statusTimestamp,
        },
      });

      // ConnectorStatusChanged 이벤트 발행
      const statusChangedPayload: ConnectorStatusChangedPayload = {
        stationId,
        connectorId,
        status: ocppStatus,
        errorCode: errorCode ?? undefined,
      };
      await writeOutbox(tx, {
        eventType: 'ConnectorStatusChanged',
        aggregateType: 'Connector',
        aggregateId: `${stationId}:${connectorId}`,
        payload: statusChangedPayload as unknown as Record<string, unknown>,
      });

      // FaultRaised: errorCode가 있고 (NoError가 아님) → 오류 발생 이벤트
      if (errorCode) {
        const faultPayload: FaultRaisedPayload = {
          stationId,
          connectorId,
          errorCode,
          info: info ?? undefined,
        };
        await writeOutbox(tx, {
          eventType: 'FaultRaised',
          aggregateType: 'Connector',
          aggregateId: `${stationId}:${connectorId}`,
          payload: faultPayload as unknown as Record<string, unknown>,
        });
      }

      // FaultCleared: 이전에 오류가 있었고 현재 errorCode가 없어진 경우 (NoError 복귀)
      if (wasInFault && !errorCode) {
        const clearedPayload: FaultClearedPayload = {
          stationId,
          connectorId,
        };
        await writeOutbox(tx, {
          eventType: 'FaultCleared',
          aggregateType: 'Connector',
          aggregateId: `${stationId}:${connectorId}`,
          payload: clearedPayload as unknown as Record<string, unknown>,
        });
      }
    });

    // If connector becomes Available, auto-stop any stuck Active/Pending transactions
    if (ocppStatus === 'Available') {
      const stuckTxs = await prisma.transaction.findMany({
        where: { stationId, connectorId, status: { in: ['Active', 'Pending'] } },
      });
      if (stuckTxs.length > 0) {
        await prisma.transaction.updateMany({
          where: { id: { in: stuckTxs.map((tx) => tx.id) } },
          data: { status: 'Stopped', timeEnd: new Date(), failReason: 'StatusNotification:Available' },
        });
        logger.info({ stationId, connectorId, count: stuckTxs.length }, 'Auto-stopped stuck transactions on Available');
      }
    }
  }

  // Record fault if status is Faulted (faultLog DB 기록 — Outbox와 별개)
  if (ocppStatus === 'Faulted') {
    const descParts = [errorCode, vendorErrorCode, info].filter(Boolean);
    const description = descParts.length > 0 ? descParts.join(' / ') : 'Charger reported Faulted status';
    await prisma.faultLog.create({
      data: {
        stationId,
        faultType: 'CommunicationError',
        description,
      },
    }).catch(() => {});
  }

  return {};
}
