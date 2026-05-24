/**
 * packages/core/src/ocpp/handlers/firmwareStatusNotification.handler.ts
 *
 * OCPP 1.6 §5.6 FirmwareStatusNotification.req 핸들러.
 *
 * Phase 2-D 변경:
 *  - 펌웨어 상태 변경 시 FirmwareStatusChanged 이벤트 Outbox 기록 추가.
 *  - Station 갱신 + Outbox를 prisma.$transaction으로 원자성 보장.
 *  - 캠페인 progress 갱신은 트랜잭션 외부 (기존 로직 유지).
 */

import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import { FirmwareCampaignProgressStatus } from '@prisma/client';
import { writeOutbox } from '../../outbox/outboxWriter';
import type { FirmwareStatusChangedPayload } from '@pvpentech/shared/types/events';

interface FirmwareStatusNotificationPayload {
  status: string; // Idle | Downloaded | DownloadFailed | Downloading | InstallationFailed | Installing | Installed
}

const VALID_STATUSES = new Set([
  'Idle',
  'Downloaded',
  'DownloadFailed',
  'Downloading',
  'InstallationFailed',
  'Installing',
  'Installed',
]);

/**
 * OCPP 1.6 → FirmwareCampaignProgressStatus 매핑.
 */
const STATUS_MAP: Record<string, FirmwareCampaignProgressStatus | null> = {
  Idle: null,                                  // 진행 중 레코드에 영향 X
  Downloading: 'downloading',
  Downloaded: 'downloaded',
  Installing: 'installing',
  Installed: 'installed',
  DownloadFailed: 'failed',
  InstallationFailed: 'failed',
};

const FINAL_STATUSES = new Set(['installed', 'failed']);

/**
 * OCPP 1.6 §5.6 FirmwareStatusNotification.req 핸들러.
 *
 * 처리:
 *  1. ChargingStation.firmwareStatus 최신 상태 갱신 + FirmwareStatusChanged Outbox 기록 (원자적)
 *  2. 가장 최근의 진행 중 FirmwareCampaignProgress (status NOT IN installed/failed)
 *     매칭 → status·completedAt·error 갱신 (Phase 4-B)
 *  3. 캠페인의 모든 progress 가 종료(installed/failed)되면 캠페인 status=completed,
 *     completedAt=now 로 자동 마감.
 */
export async function firmwareStatusNotificationHandler(
  stationId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const p = payload as unknown as FirmwareStatusNotificationPayload;
  const status = VALID_STATUSES.has(p.status) ? p.status : 'Idle';

  logger.info({ stationId, status: p.status, normalized: status }, 'FirmwareStatusNotification received');

  // ─── 원자적 트랜잭션: Station 갱신 + FirmwareStatusChanged Outbox ─────────────
  await prisma.$transaction(async (tx) => {
    await tx.chargingStation
      .update({
        where: { id: stationId },
        data: { firmwareStatus: status },
      })
      .catch((err) => {
        logger.warn({ stationId, err }, 'Failed to update firmwareStatus on station');
      });

    const fwPayload: FirmwareStatusChangedPayload = {
      stationId,
      status,
    };

    await writeOutbox(tx, {
      eventType: 'FirmwareStatusChanged',
      aggregateType: 'Station',
      aggregateId: stationId,
      payload: fwPayload as unknown as Record<string, unknown>,
    });
  }).catch((err) => {
    logger.warn({ stationId, status, err }, 'FirmwareStatusNotification: station update + outbox failed');
  });

  const mapped = STATUS_MAP[status];
  if (!mapped) {
    return {};
  }

  // ─── 트랜잭션 외 부수 효과: 캠페인 progress 갱신 ─────────────────────────────

  // 2) 진행 중 캠페인 progress 매칭 (가장 최근 sent/downloading/downloaded/installing 상태)
  const open = await prisma.firmwareCampaignProgress
    .findFirst({
      where: {
        stationId,
        status: { in: ['sent', 'downloading', 'downloaded', 'installing'] },
      },
      orderBy: { updatedAt: 'desc' },
    })
    .catch(() => null);

  if (!open) {
    logger.warn({ stationId, status }, 'FirmwareStatusNotification with no open campaign progress');
    return {};
  }

  const isFinal = FINAL_STATUSES.has(mapped);
  await prisma.firmwareCampaignProgress
    .update({
      where: { id: open.id },
      data: {
        status: mapped,
        completedAt: isFinal ? new Date() : null,
        error: mapped === 'failed' ? `OCPP status: ${status}` : null,
      },
    })
    .catch((err) => {
      logger.warn({ stationId, progressId: open.id, err }, 'Failed to update FirmwareCampaignProgress');
    });

  // 3) 캠페인이 모두 끝났으면 자동 마감
  if (isFinal) {
    const remaining = await prisma.firmwareCampaignProgress
      .count({
        where: {
          campaignId: open.campaignId,
          status: { notIn: ['installed', 'failed', 'send_error'] },
        },
      })
      .catch(() => -1);

    if (remaining === 0) {
      await prisma.firmwareCampaign
        .update({
          where: { id: open.campaignId },
          data: { status: 'completed', completedAt: new Date() },
        })
        .catch(() => {});
      logger.info({ campaignId: open.campaignId }, 'FirmwareCampaign auto-completed');
    }
  }

  return {};
}
