/**
 * Internal API — 원격 제어 명령 라우트 (Phase 2-B, B5)
 *
 * 비동기 명령: 202 Accepted + { messageId, action, status: 'sent', sentAt }
 * 실제 OCPP 응답은 OcppCommandResultReceived Redis Stream 이벤트로 Portal Consumer에 전달.
 *
 * 모든 명령은 /stations/:stationId/commands/* 경로.
 * 이 라우터는 /stations 아래에 마운트되므로 /:stationId/commands/* 형태.
 *
 * | 메서드 | 경로 | OCPP Action |
 * |--------|------|-------------|
 * | POST | /:stationId/commands/reset | Reset |
 * | POST | /:stationId/commands/change-availability | ChangeAvailability |
 * | POST | /:stationId/commands/change-configuration | ChangeConfiguration |
 * | POST | /:stationId/commands/get-configuration | GetConfiguration |
 * | POST | /:stationId/commands/clear-cache | ClearCache |
 * | POST | /:stationId/commands/unlock-connector | UnlockConnector |
 * | POST | /:stationId/commands/trigger-message | TriggerMessage |
 * | POST | /:stationId/commands/data-transfer | DataTransfer |
 */

import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { connectionManager } from '@core/ocpp/connectionManager';
import { sendReset } from '@core/ocpp/commands/reset.command';
import { sendChangeAvailability } from '@core/ocpp/commands/changeAvailability.command';
import { sendChangeConfiguration } from '@core/ocpp/commands/changeConfiguration.command';
import { sendGetConfiguration } from '@core/ocpp/commands/getConfiguration.command';
import { sendClearCache } from '@core/ocpp/commands/clearCache.command';
import { sendUnlockConnector } from '@core/ocpp/commands/unlockConnector.command';
import { sendTriggerMessage } from '@core/ocpp/commands/triggerMessage.command';
import { sendDataTransfer } from '@core/ocpp/commands/dataTransfer.command';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';
import { logger } from '@pvpentech/shared/config/logger';

const router = Router();

// ─── 공통 헬퍼 ──────────────────────────────────────────────────────────────

/**
 * 충전기 존재 여부 확인 및 연결 상태 검증.
 * 미존재 → STATION_NOT_FOUND(404), 오프라인 → STATION_OFFLINE(422)
 */
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
 * 비동기 명령 응답 형식 (202 Accepted).
 * 실제 OCPP 응답은 Redis Stream OcppCommandResultReceived 이벤트로 별도 수신.
 */
function sendAsyncCommandResponse(
  res: Response,
  action: string,
  commandPromise: Promise<unknown>,
  stationId: string,
): void {
  const messageId = uuidv4();
  const sentAt = new Date().toISOString();

  // 비동기로 OCPP 명령 실행 (응답 기다리지 않음)
  commandPromise.catch((err: Error) => {
    logger.warn({ stationId, action, messageId, err: err.message }, 'Internal API: async command error (already 202)');
  });

  res.status(202).json({
    success: true,
    data: {
      messageId,
      action,
      status: 'sent',
      sentAt,
    },
  });
}

// ─── POST /:stationId/commands/reset ─────────────────────────────────────────

router.post('/:stationId/commands/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationOnline(stationId);

    const type: 'Hard' | 'Soft' = req.body.type === 'Hard' ? 'Hard' : 'Soft';

    sendAsyncCommandResponse(
      res,
      'Reset',
      sendReset(stationId, { type }, 'internal-api'),
      stationId,
    );
  } catch (err) {
    next(err);
  }
});

// ─── POST /:stationId/commands/change-availability ───────────────────────────

router.post('/:stationId/commands/change-availability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationOnline(stationId);

    const connectorId = Number(req.body.connectorId ?? 0);
    const type: 'Operative' | 'Inoperative' =
      req.body.type === 'Inoperative' ? 'Inoperative' : 'Operative';

    sendAsyncCommandResponse(
      res,
      'ChangeAvailability',
      sendChangeAvailability(stationId, { connectorId, type }, 'internal-api'),
      stationId,
    );
  } catch (err) {
    next(err);
  }
});

// ─── POST /:stationId/commands/change-configuration ──────────────────────────

router.post('/:stationId/commands/change-configuration', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationOnline(stationId);

    const { key, value } = req.body as { key?: string; value?: string };
    if (!key || value === undefined) {
      throw InternalApiErrors.badRequest('key and value are required');
    }

    sendAsyncCommandResponse(
      res,
      'ChangeConfiguration',
      sendChangeConfiguration(stationId, { key, value: String(value) }, 'internal-api'),
      stationId,
    );
  } catch (err) {
    next(err);
  }
});

// ─── POST /:stationId/commands/get-configuration ─────────────────────────────

router.post('/:stationId/commands/get-configuration', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationOnline(stationId);

    const key: string[] | undefined = Array.isArray(req.body.key) ? req.body.key : undefined;

    sendAsyncCommandResponse(
      res,
      'GetConfiguration',
      sendGetConfiguration(stationId, { key }, 'internal-api'),
      stationId,
    );
  } catch (err) {
    next(err);
  }
});

// ─── POST /:stationId/commands/clear-cache ────────────────────────────────────

router.post('/:stationId/commands/clear-cache', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationOnline(stationId);

    sendAsyncCommandResponse(
      res,
      'ClearCache',
      sendClearCache(stationId, 'internal-api'),
      stationId,
    );
  } catch (err) {
    next(err);
  }
});

// ─── POST /:stationId/commands/unlock-connector ──────────────────────────────

router.post('/:stationId/commands/unlock-connector', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationOnline(stationId);

    const connectorId = Number(req.body.connectorId ?? 1);

    sendAsyncCommandResponse(
      res,
      'UnlockConnector',
      sendUnlockConnector(stationId, { connectorId }, 'internal-api'),
      stationId,
    );
  } catch (err) {
    next(err);
  }
});

// ─── POST /:stationId/commands/trigger-message ───────────────────────────────

router.post('/:stationId/commands/trigger-message', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationOnline(stationId);

    const validMessages = [
      'BootNotification',
      'DiagnosticsStatusNotification',
      'FirmwareStatusNotification',
      'Heartbeat',
      'MeterValues',
      'StatusNotification',
    ] as const;

    type RequestedMessage = typeof validMessages[number];
    const requestedMessage = req.body.requestedMessage as RequestedMessage;

    if (!requestedMessage || !validMessages.includes(requestedMessage)) {
      throw InternalApiErrors.badRequest(
        `requestedMessage must be one of: ${validMessages.join(', ')}`,
      );
    }

    const connectorId: number | undefined =
      req.body.connectorId !== undefined ? Number(req.body.connectorId) : undefined;

    sendAsyncCommandResponse(
      res,
      'TriggerMessage',
      sendTriggerMessage(stationId, { requestedMessage, connectorId }, 'internal-api'),
      stationId,
    );
  } catch (err) {
    next(err);
  }
});

// ─── POST /:stationId/commands/data-transfer ─────────────────────────────────

router.post('/:stationId/commands/data-transfer', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationOnline(stationId);

    const { vendorId, messageId: msgId, data } = req.body as {
      vendorId?: string;
      messageId?: string;
      data?: string;
    };

    if (!vendorId) {
      throw InternalApiErrors.badRequest('vendorId is required');
    }

    sendAsyncCommandResponse(
      res,
      'DataTransfer',
      sendDataTransfer(stationId, { vendorId, messageId: msgId, data }, 'internal-api'),
      stationId,
    );
  } catch (err) {
    next(err);
  }
});

export default router;
