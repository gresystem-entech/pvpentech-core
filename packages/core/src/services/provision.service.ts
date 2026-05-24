import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { env } from '@pvpentech/shared/config/env';
import { logger } from '@pvpentech/shared/config/logger';
import { ocppGateway } from '@core/ocpp/gateway.impl';
import { parsePagination } from '@pvpentech/shared/utils/auth';
import { generateRandomPassword } from '@pvpentech/shared/utils/crypto';
import { ConflictError, ForbiddenError, NotFoundError } from '@pvpentech/shared/errors';
import { hashPassword } from '@pvpentech/shared/utils/password';

interface ProvisionResult {
  station_id: string;
  csms_server: string;
  uri: string;
  port: number;
  password: string;
}

export class ProvisionService {
  /**
   * 충전기 프로비저닝 (v2.0)
   * @param serialNumber 충전기 시리얼번호 (origin)
   * @param model 충전기 모델명 (v2.0: required)
   * @param manufacturerId 인증된 제조사 ID (manufacturerAuth 미들웨어에서 주입)
   */
  async provision(serialNumber: string, model?: string, manufacturerId?: number): Promise<ProvisionResult> {
    // 1. 사전 등록 여부 확인
    const record = await prisma.chargerProvisioning.findUnique({
      where: { serialNumber },
    });

    // 미등록 시리얼 → 404
    if (!record) {
      logger.warn({ serialNumber }, 'Provision rejected: serial not found');
      throw new NotFoundError('등록되지 않은 충전기입니다.', 'station:provisionRejected');
    }

    // v2.0 정책 A: 제조사 채널 매핑 엄격 검증
    // - record.manufacturerId가 null(레거시 미매핑) → 404 (CS 포털에서 제조사 매핑 필수)
    // - record.manufacturerId !== 요청 manufacturerId(다른 제조사 시리얼) → 404
    // 보안: 두 경우 모두 동일 메시지로 응답 (시리얼 열거 공격 차단)
    if (manufacturerId !== undefined && record.manufacturerId !== manufacturerId) {
      logger.warn({ serialNumber, manufacturerId, recordManufacturerId: record.manufacturerId }, 'Provision rejected: manufacturer mismatch or unmapped legacy record');
      throw new NotFoundError('등록되지 않은 충전기입니다.', 'station:provisionRejected');
    }

    // rejected / revoked 상태 → 401
    if (record.status === 'rejected' || record.status === 'revoked') {
      logger.warn({ serialNumber, status: record.status }, 'Provision rejected: status rejected/revoked');
      throw new ForbiddenError('등록되지 않은 충전기입니다.', 'station:provisionRejected');
    }

    // C-1 정책: One-shot 폐기 — 동일 시리얼 재호출 시 idempotent re-provision 허용.
    // 충전기 교체(같은 시리얼 박힌 새 기기) 시 운영자 추가 작업 없이 새 자격증명 발급.
    // 보안: 기존 stationId 는 그대로 유지하고 password 만 회전 → 구 기기 OCPP 인증
    // 즉시 무효화. 이미 OCPP 연결 중인 구 기기는 connectionManager.register() 가
    // 새 기기 접속 시 자동으로 terminate.
    const isReprovision = record.status === 'provisioned';

    // 2. 충전기 아이디 결정 — 재발급 시 기존 stationId 보존 (이력·세션 연속성)
    const stationId = record.stationId || record.clientId || await this.generateStationId();

    // 3. OCPP Basic Auth 비밀번호 (재)발급
    const plainPassword = generateRandomPassword(32);
    const passwordHash = await hashPassword(plainPassword);

    // 4. 트랜잭션: ChargingStation 생성 or 업데이트 + 프로비저닝 상태 업데이트
    // (clientId로 사전 등록 시 ChargingStation이 이미 존재할 수 있으므로 upsert 사용)
    const resolvedModel = model || record.modelName || undefined;
    await prisma.$transaction([
      prisma.chargingStation.upsert({
        where: { id: stationId },
        create: {
          id: stationId,
          serialNumber,
          passwordHash,
          status: 'Offline',
          ...(resolvedModel ? { modelName: resolvedModel } : {}),
        },
        update: {
          passwordHash,
          ...(resolvedModel ? { modelName: resolvedModel } : {}),
        },
      }),
      prisma.chargerProvisioning.update({
        where: { serialNumber },
        data: {
          stationId,
          status: 'provisioned',
          provisionedAt: new Date(),
        },
      }),
    ]);

    // 4-1) 재발급이면 구 OCPP WebSocket 즉시 강제 종료 (구 기기 인증 즉시 무효화)
    if (isReprovision) {
      // forceDisconnect is safe to call regardless of connection state (no-op if not connected)
      ocppGateway.forceDisconnect(stationId);
      logger.warn(
        { stationId, serialNumber },
        'Re-provisioning: existing OCPP connection terminated',
      );
    }

    logger.info(
      { serialNumber, stationId, reprovisioned: isReprovision },
      isReprovision ? 'Re-provisioning completed (password rotated)' : 'Provisioning completed',
    );

    return {
      station_id: stationId,
      csms_server: env.CSMS_SERVER_URL,
      uri: '/ws/',
      port: 443,
      password: plainPassword,
    };
  }

  private async generateStationId(): Promise<string> {
    // Atomically increment sequence (upsert: create seed row if missing)
    const seq = await prisma.stationIdSequence.upsert({
      where: { id: 1 },
      create: { id: 1, lastNumber: 1000001 },
      update: { lastNumber: { increment: 1 } },
    });

    const numberStr = seq.lastNumber.toString().padStart(7, '0');
    return `EN${numberStr}`;
  }

  async register(
    serialNumber: string,
    registeredBy: string,
    modelName?: string,
    clientId?: string,
    siteId?: number,
    manufacturerId?: number,
  ) {
    const existing = await prisma.chargerProvisioning.findUnique({
      where: { serialNumber },
    });
    if (existing) throw new ConflictError('이미 등록된 시리얼번호입니다.');

    // clientId가 지정된 경우: ChargingStation을 즉시 생성 (passwordHash=null)
    // → 충전기가 /auths 없이도 포털 등록 직후 바로 OCPP 접속 가능
    if (clientId) {
      const existingStation = await prisma.chargingStation.findUnique({ where: { id: clientId } });
      if (existingStation) throw new ConflictError(`충전기 아이디 ${clientId}가 이미 사용 중입니다.`);

      const [, provision] = await prisma.$transaction([
        prisma.chargingStation.create({
          data: {
            id: clientId,
            serialNumber,
            passwordHash: null,
            status: 'Offline',
            ...(modelName ? { modelName } : {}),
            ...(siteId ? { siteId } : {}),
          },
        }),
        prisma.chargerProvisioning.create({
          data: {
            serialNumber,
            registeredBy,
            status: 'registered',
            clientId,
            stationId: clientId,
            ...(modelName ? { modelName } : {}),
            ...(manufacturerId ? { manufacturerId } : {}),
          },
        }),
      ]);
      return provision;
    }

    return prisma.chargerProvisioning.create({
      data: {
        serialNumber,
        registeredBy,
        status: 'registered',
        ...(modelName ? { modelName } : {}),
        ...(manufacturerId ? { manufacturerId } : {}),
      },
    });
  }

  async list(params: { status?: string; keyword?: string; page?: number; limit?: number }) {
    const { page, limit, skip } = parsePagination(params.page, params.limit);
    const where: Record<string, unknown> = {};
    if (params.status) where['status'] = params.status;
    if (params.keyword) {
      where['OR'] = [
        { serialNumber: { contains: params.keyword, mode: 'insensitive' } },
        { stationId: { contains: params.keyword, mode: 'insensitive' } },
        { registeredBy: { contains: params.keyword, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.chargerProvisioning.findMany({
        where,
        include: { chargingStation: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.chargerProvisioning.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async update(id: number, data: { serialNumber?: string; rejectReason?: string }) {
    const record = await this.findById(id);
    if (data.serialNumber && record.status === 'provisioned') {
      throw new ConflictError('프로비저닝이 완료된 항목의 시리얼번호는 변경할 수 없습니다.');
    }
    return prisma.chargerProvisioning.update({ where: { id }, data });
  }

  async bulkRegister(
    rows: Array<{ serialNumber: string; manufacturerChannelId?: string }>,
    registeredBy: string,
  ) {
    let registered = 0;
    let skipped = 0;
    const errors: { serialNumber: string; reason: string }[] = [];

    // manufacturerChannelId → manufacturerId 매핑 캐시 (같은 채널 반복 조회 방지)
    const channelCache: Record<string, number | null> = {};

    for (const row of rows) {
      const sn = row.serialNumber?.trim();
      if (!sn) { skipped++; continue; }

      try {
        let manufacturerId: number | undefined;
        if (row.manufacturerChannelId) {
          const ch = row.manufacturerChannelId.trim();
          if (!(ch in channelCache)) {
            const mfr = await prisma.manufacturer.findUnique({ where: { channelId: ch } });
            channelCache[ch] = mfr ? mfr.id : null;
          }
          if (channelCache[ch] !== null) {
            manufacturerId = channelCache[ch] as number;
          }
        }
        await this.register(sn, registeredBy, undefined, undefined, undefined, manufacturerId);
        registered++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ serialNumber: sn, reason: message });
        skipped++;
      }
    }
    return { total: rows.length, registered, skipped, errors };
  }

  async findById(id: number) {
    const record = await prisma.chargerProvisioning.findUnique({
      where: { id },
      include: { chargingStation: true },
    });
    if (!record) throw new NotFoundError('프로비저닝 레코드를 찾을 수 없습니다.');
    return record;
  }

  async findByStationId(stationId: string) {
    const record = await prisma.chargerProvisioning.findUnique({
      where: { stationId },
    });

    return record;
  }

  async revoke(id: number) {
    await this.findById(id);
    return prisma.chargerProvisioning.update({
      where: { id },
      data: { status: 'revoked' },
    });
  }

  async delete(id: number) {
    await this.findById(id);
    return prisma.chargerProvisioning.delete({ where: { id } });
  }

  async deleteByStationId(stationId: string) {
    const record = await this.findByStationId(stationId);
    if (!record) throw new NotFoundError('프로비저닝 레코드를 찾을 수 없습니다.');
    return prisma.chargerProvisioning.delete({ where: { stationId } });
  }
}

export const provisionService = new ProvisionService();
