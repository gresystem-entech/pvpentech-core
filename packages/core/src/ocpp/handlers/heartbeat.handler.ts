import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';

export async function heartbeatHandler(
  stationId: string,
  _payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  logger.debug({ stationId }, 'Heartbeat received');

  await prisma.chargingStation.update({
    where: { id: stationId },
    data: { lastHeartbeatAt: new Date() },
  }).catch(() => {
    // Station may not exist yet, ignore
  });

  return { currentTime: new Date().toISOString() };
}
