import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { Prisma } from '@prisma/client';

export const meterValueRepository = {
  findById: (id: number) =>
    prisma.meterValue.findUnique({ where: { id } }),

  findMany: (args?: Prisma.MeterValueFindManyArgs) =>
    prisma.meterValue.findMany(args),

  count: (args?: Prisma.MeterValueCountArgs) =>
    prisma.meterValue.count(args),

  create: (data: Prisma.MeterValueCreateInput) =>
    prisma.meterValue.create({ data }),

  createMany: (data: Prisma.MeterValueCreateManyInput[]) =>
    prisma.meterValue.createMany({ data }),

  findByTransactionId: (transactionId: number) =>
    prisma.meterValue.findMany({
      where: { transactionId },
      orderBy: { timestamp: 'asc' },
    }),

  getLatestByTransactionId: (transactionId: number, measurand?: string) =>
    prisma.meterValue.findFirst({
      where: {
        transactionId,
        ...(measurand ? { measurand } : {}),
      },
      orderBy: { timestamp: 'desc' },
    }),

  getEnergyReading: (transactionId: number) =>
    prisma.meterValue.findFirst({
      where: {
        transactionId,
        measurand: 'Energy.Active.Import.Register',
      },
      orderBy: { timestamp: 'desc' },
    }),

  deleteByTransactionId: (transactionId: number) =>
    prisma.meterValue.deleteMany({ where: { transactionId } }),
};
