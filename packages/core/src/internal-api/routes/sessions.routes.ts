/**
 * Internal API — 충전 세션 제어 라우트 (Phase 2-B, B6)
 *
 * 동기 명령: OCPP 응답을 30초 내에 기다려서 반환.
 *
 * | 메서드 | 경로 | OCPP Action | 동기 |
 * |--------|------|-------------|------|
 * | POST | /sessions/start | RemoteStartTransaction | 30s timeout |
 * | POST | /sessions/:sessionId/stop | RemoteStopTransaction | 30s timeout |
 *
 * 오류:
 *  - 충전기 미존재 → 404 STATION_NOT_FOUND
 *  - 충전기 오프라인 → 422 STATION_OFFLINE
 *  - OCPP 응답 타임아웃 → 504 OCPP_TIMEOUT
 *  - OCPP Rejected → 422 OCPP_REJECTED
 */

import { Router, Request, Response, NextFunction } from 'express';
import { connectionManager } from '@core/ocpp/connectionManager';
import { sendRemoteStartTransaction } from '@core/ocpp/commands/remoteStartTransaction.command';
import { sendRemoteStopTransaction } from '@core/ocpp/commands/remoteStopTransaction.command';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';
import { logger } from '@pvpentech/shared/config/logger';

const router = Router();

// ─── 공통 헬퍼 ──────────────────────────────────────────────────────────────

async function assertStationOnline(stationId: string): Promise<void> {
  const station = await prisma.chargingStation.findUnique({
    where: { id: stationId },
    select: { id: true },
  });

  if (!station) {
    throw InternalApiErrors.stationNotFound(stationId);
  }

  if (!connectionManager.isConnected(stationId)) {
    throw InternalApiErrors.stationOffline(stationId);
  }
}

/**
 * OCPP 명령 에러를 InternalApiError로 변환.
 *  - 'timeout' 포함 → OCPP_TIMEOUT(504)
 *  - 'Rejected' 포함 → OCPP_REJECTED(422)
 *  - 기타 → 원본 에러 그대로 rethrow
 */
function mapOcppError(err: unknown, stationId: string, action: string): never {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

  if (message.includes('timeout')) {
    throw InternalApiErrors.ocppTimeout(stationId, action);
  }
  if (message.includes('rejected') || message.includes('not connected')) {
    throw InternalApiErrors.ocppRejected(stationId, action);
  }
  throw err;
}

// ─── POST /sessions/start — RemoteStartTransaction ───────────────────────────

router.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      stationId,
      connectorId,
      idTag,
      chargingProfile,
    } = req.body as {
      stationId?: string;
      connectorId?: number;
      idTag?: string;
      chargingProfile?: object;
    };

    if (!stationId) {
      throw InternalApiErrors.badRequest('stationId is required');
    }
    if (!idTag) {
      throw InternalApiErrors.badRequest('idTag is required');
    }

    await assertStationOnline(stationId);

    logger.info({ stationId, connectorId, idTag }, 'Internal API: RemoteStartTransaction');

    let result: { status: 'Accepted' | 'Rejected' };
    try {
      result = await sendRemoteStartTransaction(
        stationId,
        {
          connectorId: connectorId ?? 1,
          idTag,
          ...(chargingProfile ? { chargingProfile } : {}),
        },
        'internal-api',
      );
    } catch (err) {
      mapOcppError(err, stationId, 'RemoteStartTransaction');
    }

    if (result!.status === 'Rejected') {
      throw InternalApiErrors.ocppRejected(stationId, 'RemoteStartTransaction');
    }

    res.json({
      success: true,
      data: {
        stationId,
        connectorId: connectorId ?? 1,
        idTag,
        status: result!.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /sessions/:sessionId/stop — RemoteStopTransaction ─────────────────

router.post('/:sessionId/stop', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params;

    // sessionId(transaction DB id)로 진행 중인 세션 조회 → stationId 확보
    const transaction = await prisma.transaction.findUnique({
      where: { id: Number(sessionId) },
      select: { id: true, stationId: true, ocppTransactionId: true, status: true },
    });

    if (!transaction) {
      throw InternalApiErrors.badRequest(`Session '${sessionId}' not found`);
    }

    if (!['Pending', 'Active'].includes(transaction.status)) {
      throw InternalApiErrors.badRequest(
        `Session '${sessionId}' is not active (status: ${transaction.status})`,
      );
    }

    const { stationId } = transaction;
    await assertStationOnline(stationId);

    if (!transaction.ocppTransactionId) {
      throw InternalApiErrors.badRequest(
        `Session '${sessionId}' has no OCPP transaction ID (not yet started)`,
      );
    }

    logger.info({ sessionId, stationId, ocppTransactionId: transaction.ocppTransactionId }, 'Internal API: RemoteStopTransaction');

    let result: { status: 'Accepted' | 'Rejected' };
    try {
      result = await sendRemoteStopTransaction(
        stationId,
        { transactionId: transaction.ocppTransactionId },
        'internal-api',
      );
    } catch (err) {
      mapOcppError(err, stationId, 'RemoteStopTransaction');
    }

    if (result!.status === 'Rejected') {
      throw InternalApiErrors.ocppRejected(stationId, 'RemoteStopTransaction');
    }

    res.json({
      success: true,
      data: {
        sessionId: Number(sessionId),
        stationId,
        ocppTransactionId: transaction.ocppTransactionId,
        status: result!.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
