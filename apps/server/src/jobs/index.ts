/**
 * apps/server/src/jobs/index.ts
 *
 * Legacy 호환 — Phase 2-E 이후에는 사용되지 않는다.
 * Core / Portal BullMQ 워커는 각 패키지의 bootstrap.ts 에서 관리한다:
 *   - packages/core/src/bootstrap.ts  (Core jobs)
 *   - packages/portal/src/bootstrap.ts (Portal jobs)
 *
 * 이 파일은 이전 코드가 import 하던 경로를 유지하기 위해 남겨 둔다.
 * @deprecated
 */

import { logger } from '@pvpentech/shared/config/logger';

export async function startJobWorkers(): Promise<void> {
  logger.warn(
    '[Legacy] apps/server/src/jobs/index.ts startJobWorkers() is deprecated. ' +
    'Workers are now managed by packages/core/src/bootstrap.ts and packages/portal/src/bootstrap.ts'
  );
}

export async function stopJobWorkers(): Promise<void> {
  // no-op
}
