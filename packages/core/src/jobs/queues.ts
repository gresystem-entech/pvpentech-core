import { Queue } from 'bullmq';
import { bullmqRedis } from '@pvpentech/shared/config/redis';

const connection = bullmqRedis;

export const chargeGoalQueue = new Queue('charge-goal', { connection });
export const notificationQueue = new Queue('notification', { connection });
export const cleanupQueue = new Queue('cleanup', { connection });
export const settlementQueue = new Queue('settlement', { connection });
export const postChargeBillingQueue = new Queue('post-charge-billing', { connection });
export const refundQueue = new Queue('refund', { connection });
