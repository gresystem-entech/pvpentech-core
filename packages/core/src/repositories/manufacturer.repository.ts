import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { Prisma } from '@prisma/client';

export class ManufacturerRepository {
  findByChannelId(channelId: string) {
    return prisma.manufacturer.findUnique({ where: { channelId } });
  }

  findById(id: number) {
    return prisma.manufacturer.findUnique({ where: { id } });
  }

  create(data: Prisma.ManufacturerCreateInput) {
    return prisma.manufacturer.create({ data });
  }

  update(id: number, data: Prisma.ManufacturerUpdateInput) {
    return prisma.manufacturer.update({ where: { id }, data });
  }

  findAll(params: { page: number; limit: number }) {
    const skip = (params.page - 1) * params.limit;
    return Promise.all([
      prisma.manufacturer.findMany({
        skip,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.manufacturer.count(),
    ]);
  }
}

export const manufacturerRepository = new ManufacturerRepository();
