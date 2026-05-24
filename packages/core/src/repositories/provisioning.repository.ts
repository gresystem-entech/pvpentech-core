import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { Prisma } from '@prisma/client';

export const provisioningRepository = {
  findBySerial: (serialNumber: string) =>
    prisma.chargerProvisioning.findUnique({ where: { serialNumber } }),

  findMany: (args?: Prisma.ChargerProvisioningFindManyArgs) =>
    prisma.chargerProvisioning.findMany(args),

  count: (args?: Prisma.ChargerProvisioningCountArgs) =>
    prisma.chargerProvisioning.count(args),

  create: (data: Prisma.ChargerProvisioningCreateInput) =>
    prisma.chargerProvisioning.create({ data }),

  update: (id: number, data: Prisma.ChargerProvisioningUpdateInput) =>
    prisma.chargerProvisioning.update({ where: { id }, data }),
};
