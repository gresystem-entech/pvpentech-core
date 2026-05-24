import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { Prisma } from '@prisma/client';

export class FirmwareRepository {
  findById(id: number) {
    return prisma.firmware.findUnique({ where: { id } });
  }

  findBySha256(sha256: string) {
    return prisma.firmware.findUnique({ where: { sha256 } });
  }

  create(data: Prisma.FirmwareCreateInput) {
    return prisma.firmware.create({ data });
  }

  update(id: number, data: Prisma.FirmwareUpdateInput) {
    return prisma.firmware.update({ where: { id }, data });
  }

  delete(id: number) {
    return prisma.firmware.delete({ where: { id } });
  }

  findAll(params: { page: number; limit: number; isActive?: boolean }) {
    const where: Prisma.FirmwareWhereInput = {};
    if (typeof params.isActive === 'boolean') where.isActive = params.isActive;
    const skip = (params.page - 1) * params.limit;
    return Promise.all([
      prisma.firmware.findMany({
        where,
        skip,
        take: params.limit,
        orderBy: { uploadedAt: 'desc' },
      }),
      prisma.firmware.count({ where }),
    ]);
  }

  countCampaignsForFirmware(firmwareId: number) {
    return prisma.firmwareCampaign.count({ where: { firmwareId } });
  }
}

export const firmwareRepository = new FirmwareRepository();
