import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { NotFoundError, ConflictError } from '@pvpentech/shared/errors';
import { parsePagination } from '@pvpentech/shared/utils/auth';
import { ChargerConfigStatus } from '@prisma/client';

export class ChargerConfigService {
  async list(params: { stationId?: string; page?: number; limit?: number }) {
    const { page, limit, skip } = parsePagination(params.page, params.limit);
    const where: Record<string, unknown> = {};
    if (params.stationId) where['stationId'] = params.stationId;

    const [items, total] = await Promise.all([
      prisma.chargerConfig.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.chargerConfig.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(data: { stationId: string; key: string; value?: string; status?: ChargerConfigStatus; errorDesc?: string }) {
    const existing = await prisma.chargerConfig.findUnique({
      where: { stationId_key: { stationId: data.stationId, key: data.key } },
    });
    if (existing) throw new ConflictError(`이미 존재하는 설정 키입니다: ${data.key}`);
    return prisma.chargerConfig.create({ data });
  }

  async update(id: number, data: { value?: string; status?: ChargerConfigStatus; errorDesc?: string }) {
    const existing = await prisma.chargerConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('설정 항목을 찾을 수 없습니다.');
    return prisma.chargerConfig.update({ where: { id }, data });
  }

  async delete(id: number) {
    const existing = await prisma.chargerConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('설정 항목을 찾을 수 없습니다.');
    return prisma.chargerConfig.delete({ where: { id } });
  }
}

export const chargerConfigService = new ChargerConfigService();
