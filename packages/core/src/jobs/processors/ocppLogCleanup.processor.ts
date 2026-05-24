import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';

const RETENTION_DAYS = 30;

export async function ocppLogCleanupProcessor(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const result = await prisma.ocppMessage.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });

  if (result.count > 0) {
    logger.info({ count: result.count, retentionDays: RETENTION_DAYS }, 'Cleaned up old OCPP log messages');
  }
}
