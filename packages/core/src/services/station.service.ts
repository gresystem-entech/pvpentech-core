/**
 * Phase 3-D: Core→Portal cross-schema 접근 제거.
 * - prismaLegacy.chargingSite (Portal 모델) 직접 조회 제거.
 * - create()에서 siteId 유효성 검사: chargingSite 조회 불가.
 *   siteId는 Logical FK이므로 DB 레이어에서 강제되지 않음.
 *   TODO(Phase 4): Core Internal API에 siteId 유효성 검사 엔드포인트 추가 또는
 *                 Portal에서 충전기 등록 전 사전 검증 수행.
 *   현재: siteId 값은 저장하되 존재 여부 검사를 생략 (TODO 주석으로 명시).
 */
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { env } from '@pvpentech/shared/config/env';
import { logger } from '@pvpentech/shared/config/logger';
import { ocppGateway } from '@core/ocpp/gateway.impl';
import { parsePagination } from '@pvpentech/shared/utils/auth';
import { getZonedDayRange } from '@pvpentech/shared/utils';
import { ConflictError, NotFoundError } from '@pvpentech/shared/errors';

interface CreateStationDto {
  id: string;
  siteId?: number;
  manufacturer?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  chargingKwh?: number;
}

interface UpdateStationDto {
  siteId?: number | null;
  manufacturer?: string;
  serialNumber?: string;
  modelName?: string;
  firmwareVersion?: string;
  chargingKwh?: number;
}

export class StationService {
  async list(params: {
    status?: string;
    keyword?: string;
    page?: number;
    limit?: number;
  }) {
    const { page, limit, skip } = parsePagination(params.page, params.limit);

    const where: Record<string, unknown> = {};
    if (params.status) where['status'] = params.status;
    if (params.keyword) {
      // TODO(Phase 3-D): site.siteName 검색 제거됨 (Phase 3-B: site relation → Logical FK).
      // siteName 검색은 Portal에서 ChargingSite 조회 후 stationId 목록으로 교차 검색 필요.
      where['OR'] = [
        { id: { contains: params.keyword, mode: 'insensitive' } },
        { vendorName: { contains: params.keyword, mode: 'insensitive' } },
        { manufacturer: { contains: params.keyword, mode: 'insensitive' } },
        { serialNumber: { contains: params.keyword, mode: 'insensitive' } },
        { firmwareVersion: { contains: params.keyword, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.chargingStation.findMany({
        where,
        // TODO(Phase 3-D): site include 제거됨 (Phase 3-B). siteId Logical FK만 반환.
        include: { connectors: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.chargingStation.count({ where }),
    ]);

    // 오늘 충전량 집계 — env.TIMEZONE 기준 자정(비즈니스 TZ)
    const { start: todayStart } = getZonedDayRange(env.TIMEZONE);

    const todayGroups = await prisma.transaction.groupBy({
      by: ['stationId'],
      where: {
        status: 'Stopped',
        timeStart: { gte: todayStart },
        stationId: { in: items.map((s) => s.id) },
      },
      _sum: { meterEnd: true, meterStart: true },
    });

    const todayKwhMap = new Map(
      todayGroups.map((g) => [
        g.stationId,
        Math.max(0, ((g._sum.meterEnd ?? 0) - (g._sum.meterStart ?? 0)) / 1000),
      ])
    );

    const itemsWithStatus = items.map((s) => ({
      ...s,
      isConnected: ocppGateway.isStationConnected(s.id),
      todayKwh: Math.round((todayKwhMap.get(s.id) ?? 0) * 100) / 100,
    }));

    return { items: itemsWithStatus, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const station = await prisma.chargingStation.findUnique({
      where: { id },
      // TODO(Phase 3-D): site include 제거됨 (Phase 3-B). siteId Logical FK만 반환.
      include: { connectors: true, provisioning: true, faultLogs: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });

    if (!station) throw new NotFoundError('충전기를 찾을 수 없습니다.', 'station:notFound');

    return { ...station, isConnected: ocppGateway.isStationConnected(id) };
  }

  async create(data: CreateStationDto) {
    const existing = await prisma.chargingStation.findUnique({ where: { id: data.id } });
    if (existing) throw new ConflictError('이미 존재하는 충전기 아이디입니다.');

    if (data.siteId) {
      // Phase 3-D: chargingSite는 Portal schema — Core에서 직접 조회 불가.
      // siteId는 Logical FK이므로 DB 레이어에서 강제 검증되지 않음.
      // TODO(Phase 4): Portal → Core 등록 플로우에서 사전 검증 또는 Internal API siteId 조회 추가.
      // 현재: siteId 값을 저장만 함 (존재 여부 검사 생략).
    }

    return prisma.chargingStation.create({ data });
  }

  async update(id: string, data: UpdateStationDto) {
    await this.findById(id);
    return prisma.chargingStation.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.findById(id);

    // 1) 진행 중인 충전 세션이 있으면 삭제 불가
    const activeSession = await prisma.transaction.findFirst({
      where: { stationId: id, status: { in: ['Pending', 'Active'] } },
    });
    if (activeSession) {
      throw new ConflictError(
        '진행 중인 충전 세션이 있어 삭제할 수 없습니다. 충전이 완료된 후 다시 시도하세요.',
        'station:activeSession',
      );
    }

    // 2) 결제·정산 감사 데이터 보호 — 완료된 충전 이력이 있으면 삭제 불가
    const txCount = await prisma.transaction.count({ where: { stationId: id } });
    if (txCount > 0) {
      throw new ConflictError(
        '충전 이력이 있는 충전기는 삭제할 수 없습니다. 결제·정산 기록 보존을 위해 충전 기록이 없는 상태에서만 삭제할 수 있습니다.',
        'station:hasTransactionHistory',
      );
    }

    // 3) 자식 운영 데이터 cascade — 단일 트랜잭션으로 묶어 부분 실패 방지
    //    감사용 ChargerProvisioning / OcppCommandResult / FirmwareCampaignProgress 는
    //    삭제하지 않고 stationId 만 unlink(SetNull) (이력 보존)
    await prisma.$transaction([
      prisma.ocppMessage.deleteMany({ where: { stationId: id } }),
      prisma.offlineLog.deleteMany({ where: { stationId: id } }),
      prisma.faultLog.deleteMany({ where: { stationId: id } }),
      prisma.deviceVariable.deleteMany({ where: { stationId: id } }),
      prisma.chargerConfig.deleteMany({ where: { stationId: id } }),
      prisma.diagnosticsRequest.deleteMany({ where: { stationId: id } }),
      prisma.connector.deleteMany({ where: { stationId: id } }),
      prisma.firmwareCampaignProgress.updateMany({
        where: { stationId: id },
        data: { stationId: null },
      }),
      prisma.chargerProvisioning.updateMany({
        where: { stationId: id },
        data: { stationId: null },
      }),
      prisma.chargingStation.delete({ where: { id } }),
    ]);

    logger.info({ stationId: id }, 'Station hard-deleted with cascade');
    return { id, deleted: true };
  }

  async updateOnBoot(
    stationId: string,
    data: {
      modelName: string;
      vendorName: string;
      firmwareVersion?: string;
      status: 'Online';
    }
  ) {
    await prisma.chargingStation.upsert({
      where: { id: stationId },
      update: { ...data, lastHeartbeatAt: new Date() },
      create: { id: stationId, ...data },
    });
    logger.info({ stationId }, 'Station updated on boot');
  }

  async addFaultLog(
    stationId: string,
    data: { faultType: string; description?: string; reportedBy: string }
  ) {
    await this.findById(stationId);
    return prisma.faultLog.create({
      data: {
        stationId,
        faultType: data.faultType as 'ConnectorFault' | 'CommunicationError' | 'PowerFault' | 'Other',
        description: data.description,
        reportedBy: data.reportedBy,
      },
    });
  }

  async getFaultLogs(stationId: string, page = 1, limit = 20) {
    const { skip } = parsePagination(page, limit);
    const [items, total] = await Promise.all([
      prisma.faultLog.findMany({
        where: { stationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.faultLog.count({ where: { stationId } }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async resetPassword(stationId: string): Promise<string> {
    const { generateRandomPassword } = await import('@pvpentech/shared/utils/crypto');
    const { hashPassword } = await import('@pvpentech/shared/utils/password');

    await this.findById(stationId);
    const plainPassword = generateRandomPassword(32);
    const passwordHash = await hashPassword(plainPassword);

    await prisma.chargingStation.update({
      where: { id: stationId },
      data: { passwordHash },
    });

    logger.info({ stationId }, 'Station OCPP password reset');
    return plainPassword;
  }

  async getOnlineStations() {
    const connectedIds = ocppGateway.getConnectedStationIds();
    if (connectedIds.length === 0) return [];

    // TODO(Phase 3-D): site include 제거됨 (Phase 3-B). siteId Logical FK만 반환.
    return prisma.chargingStation.findMany({
      where: { id: { in: connectedIds } },
      include: { connectors: true },
    });
  }
}

export const stationService = new StationService();
