import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { parsePagination } from '@pvpentech/shared/utils/auth';

export class FaultLogService {
  async list(params: {
    stationId?: string;
    resolved?: boolean;
    page?: number;
    limit?: number;
  }) {
    const { page, limit, skip } = parsePagination(params.page, params.limit);

    const where: Record<string, unknown> = {};
    if (params.stationId) where['stationId'] = params.stationId;
    if (params.resolved === true) where['resolvedAt'] = { not: null };
    if (params.resolved === false) where['resolvedAt'] = null;

    const [items, total] = await Promise.all([
      prisma.faultLog.findMany({
        where,
        include: { station: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.faultLog.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async resolve(id: number, resolvedBy?: string) {
    return prisma.faultLog.update({
      where: { id },
      data: { resolvedAt: new Date(), reportedBy: resolvedBy },
    });
  }
}

export const faultLogService = new FaultLogService();
