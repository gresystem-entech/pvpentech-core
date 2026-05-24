import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { Prisma } from '@prisma/client';

export const faultLogRepository = {
  findById: (id: number) =>
    prisma.faultLog.findUnique({ where: { id } }),

  findByIdWithStation: (id: number) =>
    prisma.faultLog.findUnique({ where: { id }, include: { station: true } }),

  findMany: (args?: Prisma.FaultLogFindManyArgs) =>
    prisma.faultLog.findMany(args),

  count: (args?: Prisma.FaultLogCountArgs) =>
    prisma.faultLog.count(args),

  create: (data: Prisma.FaultLogCreateInput) =>
    prisma.faultLog.create({ data }),

  update: (id: number, data: Prisma.FaultLogUpdateInput) =>
    prisma.faultLog.update({ where: { id }, data }),

  markResolved: (id: number, resolvedBy?: string) =>
    prisma.faultLog.update({
      where: { id },
      data: { resolvedAt: new Date(), reportedBy: resolvedBy },
    }),

  findUnresolved: (args?: Prisma.FaultLogFindManyArgs) =>
    prisma.faultLog.findMany({
      ...args,
      where: { ...args?.where as object, resolvedAt: null },
      include: { station: true },
    }),

  findByStationId: (stationId: string, args?: Prisma.FaultLogFindManyArgs) =>
    prisma.faultLog.findMany({
      ...args,
      where: { ...args?.where as object, stationId },
      include: { station: true },
      orderBy: { createdAt: 'desc' },
    }),

  countByStationId: (stationId: string) =>
    prisma.faultLog.count({ where: { stationId } }),

  countUnresolved: (stationId?: string) =>
    prisma.faultLog.count({
      where: { resolvedAt: null, ...(stationId ? { stationId } : {}) },
    }),
};
