import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { parsePagination } from '@pvpentech/shared/utils/auth';

interface LogOcppMessageDto {
  stationId: string;
  messageId: string;
  direction: number;
  action?: string;
  payload: string;
}

export class OcppMessageService {
  async log(data: LogOcppMessageDto): Promise<void> {
    await prisma.ocppMessage.create({ data }).catch(() => {
      // Non-critical — log failure silently
    });
  }

  async list(params: {
    stationId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const { page, limit, skip } = parsePagination(params.page, params.limit);

    const where: Record<string, unknown> = {};
    if (params.stationId) where['stationId'] = params.stationId;
    if (params.action) where['action'] = params.action;
    if (params.startDate || params.endDate) {
      where['createdAt'] = {};
      if (params.startDate)
        (where['createdAt'] as Record<string, unknown>)['gte'] = new Date(params.startDate);
      if (params.endDate)
        (where['createdAt'] as Record<string, unknown>)['lte'] = new Date(params.endDate);
    }

    const [items, total] = await Promise.all([
      prisma.ocppMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.ocppMessage.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async deleteOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await prisma.ocppMessage.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}

export const ocppMessageService = new OcppMessageService();
