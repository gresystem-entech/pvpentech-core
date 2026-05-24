import { ocppCommandResultService } from '@core/services/ocppCommandResult.service';
import { logger } from '@pvpentech/shared/config/logger';

/**
 * OcppCommandResult 의 stale pending 항목을 주기적으로 timeout 처리.
 * - 부팅 시 한 번 + 60초마다 반복.
 * - PM2 reload / 프로세스 크래시로 인메모리 timer 가 사라진 케이스를 방어.
 */

const SWEEP_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

export async function startOcppCommandSweeper(): Promise<void> {
  if (timer) return;

  // 부팅 cleanup — 이전 인스턴스의 잔재 정리
  try {
    const cleaned = await ocppCommandResultService.bootstrapCleanup();
    if (cleaned > 0) {
      logger.info({ count: cleaned }, 'OCPP command bootstrap cleanup completed');
    }
  } catch (err) {
    logger.error({ err }, 'OCPP command bootstrap cleanup failed');
  }

  // 주기 sweeper
  const tick = async (): Promise<void> => {
    try {
      await ocppCommandResultService.sweepStalePending();
    } catch (err) {
      logger.error({ err }, 'OCPP command sweeper tick failed');
    }
  };

  timer = setInterval(tick, SWEEP_INTERVAL_MS);
  // node 가 이 타이머 때문에 종료를 미루지 않도록
  if (typeof timer.unref === 'function') timer.unref();

  logger.info({ intervalMs: SWEEP_INTERVAL_MS }, 'OCPP command sweeper started');
}

export function stopOcppCommandSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('OCPP command sweeper stopped');
  }
}
