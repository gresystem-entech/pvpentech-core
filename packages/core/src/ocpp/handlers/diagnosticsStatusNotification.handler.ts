import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import { DiagnosticsStatus } from '@prisma/client';

interface DiagnosticsStatusNotificationPayload {
  status: string; // Idle | Uploaded | UploadFailed | Uploading
}

const VALID_STATUSES = new Set(['Idle', 'Uploaded', 'UploadFailed', 'Uploading']);

/**
 * OCPP 1.6 §5.5 DiagnosticsStatusNotification.req 핸들러.
 *
 * 처리:
 *  1. ChargingStation.diagnosticsStatus 최신 상태 갱신 (Phase 2 호환)
 *  2. 해당 station 의 가장 최근 진행 중인 DiagnosticsRequest 매칭 → status·completedAt 갱신 (Phase 4-A)
 *
 * 진행 중 판정: completedAt IS NULL AND status != 'Uploaded'/'UploadFailed'.
 *   - Uploading 수신 → status=Uploading 갱신
 *   - Uploaded 수신 → status=Uploaded, completedAt=now
 *   - UploadFailed 수신 → status=UploadFailed, completedAt=now
 *   - Idle 수신 → 진행 중 레코드 없을 가능성 — 그냥 station 만 갱신
 */
export async function diagnosticsStatusNotificationHandler(
  stationId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const p = payload as unknown as DiagnosticsStatusNotificationPayload;
  const status = VALID_STATUSES.has(p.status) ? p.status : 'Idle';

  logger.info({ stationId, status: p.status, normalized: status }, 'DiagnosticsStatusNotification received');

  // 1) Station 최신 상태
  await prisma.chargingStation
    .update({
      where: { id: stationId },
      data: { diagnosticsStatus: status },
    })
    .catch((err) => {
      logger.warn({ stationId, err }, 'Failed to update diagnosticsStatus on station');
    });

  // 2) 가장 최근의 진행 중인 DiagnosticsRequest 갱신
  if (status !== 'Idle') {
    const open = await prisma.diagnosticsRequest
      .findFirst({
        where: { stationId, completedAt: null },
        orderBy: { requestedAt: 'desc' },
      })
      .catch(() => null);

    if (open) {
      const isFinal = status === 'Uploaded' || status === 'UploadFailed';
      await prisma.diagnosticsRequest
        .update({
          where: { id: open.id },
          data: {
            status: status as DiagnosticsStatus,
            completedAt: isFinal ? new Date() : null,
          },
        })
        .catch((err) => {
          logger.warn({ stationId, requestId: open.id, err }, 'Failed to update DiagnosticsRequest status');
        });
    } else {
      logger.warn({ stationId, status }, 'DiagnosticsStatusNotification with no open DiagnosticsRequest');
    }
  }

  return {};
}
