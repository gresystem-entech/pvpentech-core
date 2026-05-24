/**
 * packages/core/src/ocpp/handlers/bootNotification.handler.ts
 *
 * OCPP 1.6 §6.2 BootNotification.req 핸들러.
 *
 * Phase 2-D 변경:
 *  - 부팅 성공 시 StationOnline 이벤트 Outbox 기록 추가.
 *  - DB 갱신과 Outbox 기록을 prisma.$transaction으로 원자성 보장.
 *  - 기존 stuck tx 정리는 트랜잭션 외부에서 별도 처리 (부수 효과).
 */

import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import { env } from '@pvpentech/shared/config/env';
import { writeOutbox } from '../../outbox/outboxWriter';
import type { StationOnlinePayload } from '@pvpentech/shared/types/events';

interface BootNotificationPayload {
  chargePointModel: string;
  chargePointVendor: string;
  firmwareVersion?: string;
  chargePointSerialNumber?: string;
}

interface BootNotificationResponse {
  status: 'Accepted' | 'Pending' | 'Rejected';
  currentTime: string;
  interval: number;
}

export async function bootNotificationHandler(
  stationId: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const p = payload as unknown as BootNotificationPayload;
  logger.info({ stationId, payload }, 'BootNotification received');

  // ─── 원자적 트랜잭션: DB 갱신 + StationOnline Outbox 기록 ───────────────────
  const station = await prisma.chargingStation.findUnique({ where: { id: stationId } });

  await prisma.$transaction(async (tx) => {
    if (!station) {
      // Auto-create station if doesn't exist (for stations not provisioned)
      await tx.chargingStation.create({
        data: {
          id: stationId,
          modelName: p.chargePointModel,
          vendorName: p.chargePointVendor,
          firmwareVersion: p.firmwareVersion,
          serialNumber: p.chargePointSerialNumber,
          status: 'Online',
          lastHeartbeatAt: new Date(),
        },
      });
    } else {
      await tx.chargingStation.update({
        where: { id: stationId },
        data: {
          modelName: p.chargePointModel,
          vendorName: p.chargePointVendor,
          firmwareVersion: p.firmwareVersion,
          status: 'Online',
          lastHeartbeatAt: new Date(),
        },
      });
    }

    const onlinePayload: StationOnlinePayload = {
      stationId,
      chargePointVendor: p.chargePointVendor,
      chargePointModel: p.chargePointModel,
      firmwareVersion: p.firmwareVersion,
    };

    await writeOutbox(tx, {
      eventType: 'StationOnline',
      aggregateType: 'Station',
      aggregateId: stationId,
      payload: onlinePayload as unknown as Record<string, unknown>,
    });
  });

  // ─── 트랜잭션 외 부수 효과: stuck tx 정리 ───────────────────────────────────
  // On reboot, auto-stop any stuck Active/Pending transactions for this station.
  const stuckTxCount = await prisma.transaction.updateMany({
    where: { stationId, status: { in: ['Active', 'Pending'] } },
    data: { status: 'Stopped', timeEnd: new Date(), failReason: 'BootNotification:Reset' },
  }).then((r) => r.count).catch(() => 0);

  if (stuckTxCount > 0) {
    logger.info({ stationId, count: stuckTxCount }, 'Auto-stopped stuck transactions on BootNotification');
  }

  const response: BootNotificationResponse = {
    status: 'Accepted',
    currentTime: new Date().toISOString(),
    interval: env.OCPP_HEARTBEAT_INTERVAL_SEC,
  };

  logger.info({ stationId }, 'BootNotification processed — StationOnline event queued via Outbox');

  return response as unknown as Record<string, unknown>;
}
