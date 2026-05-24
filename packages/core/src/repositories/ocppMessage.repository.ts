import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { Prisma } from '@prisma/client';

export const ocppMessageRepository = {
  create: (data: Prisma.OcppMessageCreateInput) =>
    prisma.ocppMessage.create({ data }),

  findMany: (args?: Prisma.OcppMessageFindManyArgs) =>
    prisma.ocppMessage.findMany(args),

  count: (args?: Prisma.OcppMessageCountArgs) =>
    prisma.ocppMessage.count(args),

  findByStationId: (stationId: string, limit = 50) =>
    prisma.ocppMessage.findMany({
      where: { stationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),

  findRecent: (limit = 100) =>
    prisma.ocppMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),

  deleteOlderThan: (cutoffDate: Date) =>
    prisma.ocppMessage.deleteMany({
      where: { createdAt: { lt: cutoffDate } },
    }),
};
