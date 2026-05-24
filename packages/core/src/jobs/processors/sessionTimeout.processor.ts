import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';

const PENDING_TIMEOUT_MINUTES = 5;

export async function sessionTimeoutProcessor(): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MINUTES * 60 * 1000);

  const result = await prisma.transaction.updateMany({
    where: {
      status: 'Pending',
      timeStart: { lt: cutoff },
    },
    data: {
      status: 'Failed',
      failReason: 'session_timeout',
      timeEnd: new Date(),
    },
  });

  if (result.count > 0) {
    logger.info({ count: result.count }, 'Timed out pending sessions marked as failed');
  }
}
