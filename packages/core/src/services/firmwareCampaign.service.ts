import { Prisma } from '@prisma/client';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import { ocppGateway } from '@core/ocpp/gateway.impl';
import { firmwareService } from '@core/services/firmware.service';
import { ConflictError, NotFoundError, BadRequestError } from '@pvpentech/shared/errors';

export interface CampaignTargetFilter {
  /** 명시적 station ID 목록 (지정 시 다른 필터는 무시) */
  stationIds?: string[];
  /** 모델명 매칭 */
  model?: string;
  /** 제조사명 매칭 (vendorName 또는 manufacturer) */
  vendor?: string;
  /** 특정 charging_site 의 모든 충전기 */
  siteId?: number;
}

interface StartCampaignParams {
  firmwareId: number;
  targetFilter: CampaignTargetFilter;
  startedBy: string;
  notes?: string;
}

/**
 * 펌웨어 일괄 업데이트 캠페인 (REQ-FW-003).
 *
 * 단계:
 *  1. 대상 충전기 목록 산출 (targetFilter 기반)
 *  2. FirmwareCampaign + FirmwareCampaignProgress[] (status=queued) 생성
 *  3. 각 충전기에 UpdateFirmware 비동기 송신 → progress.status 갱신
 *     - 송신 성공 → status=sent, startedAt=now
 *     - 송신 실패 (오프라인 등) → status=send_error, error=메시지
 *  4. FirmwareStatusNotification 핸들러가 이후 진행 상황 갱신
 */
export class FirmwareCampaignService {
  async start(params: StartCampaignParams) {
    const { firmwareId, targetFilter, startedBy, notes } = params;

    const firmware = await firmwareService.findById(firmwareId);
    if (!firmware.isActive) {
      throw new ConflictError(
        '비활성 펌웨어로는 캠페인을 시작할 수 없습니다. 활성화 후 다시 시도하세요.',
        'firmware:inactive',
      );
    }

    const stationIds = await this.resolveTargets(targetFilter);
    if (stationIds.length === 0) {
      throw new BadRequestError(
        '대상 충전기가 없습니다. 필터를 확인하세요.',
        'firmwareCampaign:noTargets',
      );
    }

    // 트랜잭션으로 캠페인 + progress 일괄 생성
    const campaign = await prisma.$transaction(async (tx) => {
      const c = await tx.firmwareCampaign.create({
        data: {
          firmwareId,
          targetFilter: targetFilter as unknown as Prisma.InputJsonValue,
          status: 'running',
          startedBy,
          notes: notes ?? null,
        },
      });
      await tx.firmwareCampaignProgress.createMany({
        data: stationIds.map((stationId) => ({
          campaignId: c.id,
          stationId,
          status: 'queued' as const,
        })),
      });
      return c;
    });

    logger.info(
      { campaignId: campaign.id, firmwareId, stationCount: stationIds.length, startedBy },
      'FirmwareCampaign started',
    );

    // 비동기로 각 충전기에 UpdateFirmware 송신 (트랜잭션 밖에서)
    void this.dispatchAll(campaign.id, firmware.filename, stationIds, startedBy);

    return { ...campaign, totalTargets: stationIds.length };
  }

  /**
   * 대상 충전기 ID 목록 산출.
   * stationIds 가 지정되면 그것만 사용 (다른 필터 무시).
   * 그 외엔 model/vendor/siteId 의 AND 조합.
   */
  private async resolveTargets(filter: CampaignTargetFilter): Promise<string[]> {
    if (filter.stationIds && filter.stationIds.length > 0) {
      return filter.stationIds;
    }

    const where: Prisma.ChargingStationWhereInput = {};
    if (filter.model) where.modelName = filter.model;
    if (filter.vendor) {
      where.OR = [
        { vendorName: filter.vendor },
        { manufacturer: filter.vendor },
      ];
    }
    if (filter.siteId) where.siteId = filter.siteId;

    if (Object.keys(where).length === 0) {
      throw new BadRequestError('targetFilter 가 비어 있습니다.', 'firmwareCampaign:emptyFilter');
    }

    const stations = await prisma.chargingStation.findMany({ where, select: { id: true } });
    return stations.map((s) => s.id);
  }

  private async dispatchAll(
    campaignId: number,
    firmwareFilename: string,
    stationIds: string[],
    startedBy: string,
  ): Promise<void> {
    const downloadUrl = firmwareService.buildDownloadUrl(firmwareFilename);
    const retrieveDate = new Date().toISOString();

    for (const stationId of stationIds) {
      // 오프라인 충전기는 즉시 send_error
      if (!ocppGateway.isStationConnected(stationId)) {
        await prisma.firmwareCampaignProgress
          .updateMany({
            where: { campaignId, stationId },
            data: {
              status: 'send_error',
              error: 'station offline',
              startedAt: new Date(),
              completedAt: new Date(),
            },
          })
          .catch(() => {});
        continue;
      }

      try {
        await ocppGateway.updateFirmware({
          stationId,
          location: downloadUrl,
          retrieveDate,
          requestedBy: startedBy,
        });
        await prisma.firmwareCampaignProgress
          .updateMany({
            where: { campaignId, stationId },
            data: { status: 'sent', startedAt: new Date() },
          })
          .catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ campaignId, stationId, err: msg }, 'UpdateFirmware send failed');
        await prisma.firmwareCampaignProgress
          .updateMany({
            where: { campaignId, stationId },
            data: {
              status: 'send_error',
              error: msg.slice(0, 500),
              startedAt: new Date(),
              completedAt: new Date(),
            },
          })
          .catch(() => {});
      }
    }
  }

  async findById(id: number) {
    const c = await prisma.firmwareCampaign.findUnique({
      where: { id },
      include: { firmware: true, progress: true },
    });
    if (!c) throw new NotFoundError('캠페인을 찾을 수 없습니다.', 'firmwareCampaign:notFound');
    return c;
  }

  async list(params: { page: number; limit: number; status?: string; firmwareId?: number }) {
    const where: Prisma.FirmwareCampaignWhereInput = {};
    if (params.status) {
      where.status = params.status as 'running' | 'completed' | 'cancelled';
    }
    if (params.firmwareId) where.firmwareId = params.firmwareId;

    const skip = (params.page - 1) * params.limit;
    const [items, total] = await Promise.all([
      prisma.firmwareCampaign.findMany({
        where,
        include: {
          firmware: { select: { id: true, version: true, originalName: true } },
          _count: { select: { progress: true } },
        },
        skip,
        take: params.limit,
        orderBy: { startedAt: 'desc' },
      }),
      prisma.firmwareCampaign.count({ where }),
    ]);
    return { items, total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) };
  }

  async cancel(id: number) {
    const c = await this.findById(id);
    if (c.status !== 'running') {
      throw new ConflictError(
        `이미 ${c.status} 상태인 캠페인은 취소할 수 없습니다.`,
        'firmwareCampaign:notRunning',
      );
    }
    await prisma.firmwareCampaign.update({
      where: { id },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    logger.info({ campaignId: id }, 'FirmwareCampaign cancelled');
    return { id, cancelled: true };
  }
}

export const firmwareCampaignService = new FirmwareCampaignService();
