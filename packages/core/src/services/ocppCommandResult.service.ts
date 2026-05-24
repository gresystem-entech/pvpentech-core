import { Prisma, OcppCommandStatus } from '@prisma/client';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { env } from '@pvpentech/shared/config/env';
import { logger } from '@pvpentech/shared/config/logger';
import { parsePagination } from '@pvpentech/shared/utils/auth';

/**
 * OcppCommandResult 운영·감사 서비스 (Phase 4-C, REQ-PROTO-002 완전 충족).
 *
 * Phase 3 에서 sendCommand 헬퍼가 응답 영속화를 도입했으나, 인메모리
 * pendingRequests Map 의 timer 가 PM2 reload 시 사라져 status='pending' 인
 * 레코드가 영원히 남는 문제가 있었음.
 *
 * 이 서비스는:
 *  - bootstrapCleanup(): 서버 부팅 시 이전 세션의 잔재 정리
 *  - sweepStalePending(): 주기적으로 호출되어 timeout 미감지 항목 마킹
 *  - list/findById: 운영자 후행 조회
 */
class OcppCommandResultService {
  /**
   * 서버 부팅 시 1회 호출.
   * 이전 인스턴스가 비정상 종료되면서 status='pending' 으로 남은 레코드를
   * 모두 timeout 으로 정리. 인메모리 Promise 는 어차피 사라졌으므로 응답 받아도
   * resolve 할 수 없음 → DB 레벨에서 일관성 회복.
   */
  async bootstrapCleanup(): Promise<number> {
    const result = await prisma.ocppCommandResult.updateMany({
      where: { status: 'pending' as OcppCommandStatus },
      data: {
        status: 'timeout',
        errorDescription: 'pending at server bootstrap (previous instance shutdown)',
        receivedAt: new Date(),
      },
    });
    if (result.count > 0) {
      logger.warn({ count: result.count }, 'Bootstrap cleanup: stale pending OCPP commands marked as timeout');
    }
    return result.count;
  }

  /**
   * 주기적으로 호출되어 OCPP_RESPONSE_TIMEOUT_MS 보다 오래된 pending 을 timeout 처리.
   * 인메모리 timer 가 setTimeout 으로 처리하지만, 다음 케이스는 sweeper 로만 감지 가능:
   *  - PM2 reload 후 인메모리 Map 은 비었지만 DB 의 pending 레코드는 그대로
   *  - 송신 직후 프로세스 크래시
   * margin: timeout 만료 후 추가 60초 대기하여 인메모리 처리와의 race 회피.
   */
  async sweepStalePending(): Promise<number> {
    const cutoff = new Date(Date.now() - env.OCPP_RESPONSE_TIMEOUT_MS - 60_000);
    const result = await prisma.ocppCommandResult.updateMany({
      where: {
        status: 'pending' as OcppCommandStatus,
        sentAt: { lt: cutoff },
      },
      data: {
        status: 'timeout',
        errorDescription: 'timeout detected by sweeper',
        receivedAt: new Date(),
      },
    });
    if (result.count > 0) {
      logger.warn({ count: result.count, cutoffMs: env.OCPP_RESPONSE_TIMEOUT_MS }, 'Sweeper: stale pending marked as timeout');
    }
    return result.count;
  }

  // ─── 운영자 후행 조회 (Phase 4-C 신규) ───────────────────────

  async list(params: {
    page?: number;
    limit?: number;
    stationId?: string;
    action?: string;
    status?: string;
    requestedBy?: string;
    sentFrom?: Date;
    sentTo?: Date;
  }) {
    const { page, limit, skip } = parsePagination(params.page, params.limit);

    const where: Prisma.OcppCommandResultWhereInput = {};
    if (params.stationId) where.stationId = params.stationId;
    if (params.action) where.action = params.action;
    if (params.status) where.status = params.status as OcppCommandStatus;
    if (params.requestedBy) where.requestedBy = params.requestedBy;
    if (params.sentFrom || params.sentTo) {
      where.sentAt = {};
      if (params.sentFrom) (where.sentAt as { gte?: Date }).gte = params.sentFrom;
      if (params.sentTo) (where.sentAt as { lte?: Date }).lte = params.sentTo;
    }

    const [items, total] = await Promise.all([
      prisma.ocppCommandResult.findMany({
        where,
        skip,
        take: limit,
        orderBy: { sentAt: 'desc' },
      }),
      prisma.ocppCommandResult.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: number) {
    return prisma.ocppCommandResult.findUnique({ where: { id } });
  }

  async findByMessageId(messageId: string) {
    return prisma.ocppCommandResult.findUnique({ where: { messageId } });
  }

  /**
   * 통계: 최근 N일간 status 별 카운트 (운영 대시보드용).
   */
  async statsByStatus(days = 7) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const grouped = await prisma.ocppCommandResult.groupBy({
      by: ['status'],
      where: { sentAt: { gte: since } },
      _count: true,
    });
    return grouped.map((g) => ({ status: g.status, count: g._count }));
  }
}

export const ocppCommandResultService = new OcppCommandResultService();
