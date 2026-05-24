import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { Prisma, StationStatus } from '@prisma/client';

export const stationRepository = {
  findById: (id: string) =>
    prisma.chargingStation.findUnique({ where: { id }, include: { connectors: true } }),

  findByIdWithDetails: (id: string) =>
    // TODO(Phase 3-D): site relation 제거됨 (Phase 3-B). siteId Logical FK만 반환.
    // Portal에서 siteId로 ChargingSite를 별도 조회 필요.
    prisma.chargingStation.findUnique({
      where: { id },
      include: { connectors: true, faultLogs: { orderBy: { createdAt: 'desc' }, take: 10 } },
    }),

  findMany: (args?: Prisma.ChargingStationFindManyArgs) =>
    prisma.chargingStation.findMany(args),

  count: (args?: Prisma.ChargingStationCountArgs) =>
    prisma.chargingStation.count(args),

  create: (data: Prisma.ChargingStationCreateInput) =>
    prisma.chargingStation.create({ data }),

  upsert: (id: string, createData: Prisma.ChargingStationCreateInput, updateData: Prisma.ChargingStationUpdateInput) =>
    prisma.chargingStation.upsert({
      where: { id },
      create: createData,
      update: updateData,
    }),

  update: (id: string, data: Prisma.ChargingStationUpdateInput) =>
    prisma.chargingStation.update({ where: { id }, data }),

  delete: (id: string) =>
    prisma.chargingStation.delete({ where: { id } }),

  updateStatus: (id: string, status: StationStatus) =>
    prisma.chargingStation.update({ where: { id }, data: { status } }),

  findWithConnectors: (id: string) =>
    prisma.chargingStation.findUnique({
      where: { id },
      include: { connectors: true },
    }),

  findOnline: (connectedIds: string[]) =>
    // TODO(Phase 3-D): site relation 제거됨 (Phase 3-B). siteId만 반환.
    prisma.chargingStation.findMany({
      where: { id: { in: connectedIds } },
      include: { connectors: true },
    }),

  updateConnectorStatus: (stationId: string, connectorId: number, currentStatus: string) =>
    prisma.connector.updateMany({
      where: { stationId, connectorId },
      data: { currentStatus: currentStatus as import('@prisma/client').ConnectorStatus },
    }),

  findConnector: (stationId: string, connectorId: number) =>
    prisma.connector.findFirst({ where: { stationId, connectorId } }),

  upsertConnector: (stationId: string, connectorId: number, currentStatus: string) =>
    prisma.connector.upsert({
      where: { stationId_connectorId: { stationId, connectorId } },
      create: { stationId, connectorId, currentStatus: currentStatus as import('@prisma/client').ConnectorStatus },
      update: { currentStatus: currentStatus as import('@prisma/client').ConnectorStatus },
    }),

  updateHeartbeat: (id: string) =>
    prisma.chargingStation.update({ where: { id }, data: { lastHeartbeatAt: new Date() } }),

  updatePassword: (id: string, passwordHash: string) =>
    prisma.chargingStation.update({ where: { id }, data: { passwordHash } }),
};
