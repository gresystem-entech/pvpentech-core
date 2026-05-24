import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { connectionManager } from './connectionManager';
import { messageRouter } from './messageRouter';
import { logger } from '@pvpentech/shared/config/logger';
import { verifyOcppBasicAuth } from '@pvpentech/shared/utils/auth';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { writeOfflineLog } from './handlers/statusNotification.handler';
import { writeOutbox } from '../outbox/outboxWriter';
import type { StationOfflinePayload } from '@pvpentech/shared/types/events';

// Supported paths:
//   /ocpp/<stationId>   (legacy)
//   /<stationId>        (new — used by provisioned chargers)
function extractStationId(url: string | undefined): string | undefined {
  const urlPath = url || '';
  const pathParts = urlPath.split('/').filter(Boolean);

  if (urlPath.startsWith('/ocpp/')) {
    const candidate = pathParts[pathParts.length - 1];
    return candidate && candidate !== 'ocpp' ? candidate : undefined;
  }
  if (pathParts.length === 1) {
    return pathParts[0];
  }
  return undefined;
}

export function initOcppWebSocketServer(server: http.Server): void {
  const wss = new WebSocketServer({
    server,
    handleProtocols: (protocols) => {
      // OCPP 1.6 subprotocol negotiation
      if (protocols.has('ocpp1.6')) return 'ocpp1.6';
      return false;
    },
    // Authenticate during the upgrade handshake so that the 101 response is
    // delayed until auth completes. This prevents a race where the client
    // sends OCPP frames (e.g. BootNotification) before `ws.on('message')`
    // has been attached, which would silently drop the message.
    verifyClient: (info, cb) => {
      const stationId = extractStationId(info.req.url);
      if (!stationId) {
        logger.warn({ url: info.req.url }, 'WebSocket connection rejected: invalid OCPP path');
        cb(false, 400, 'Station ID required');
        return;
      }
      const authHeader = info.req.headers['authorization'] as string | undefined;
      verifyOcppBasicAuth(stationId, authHeader)
        .then((ok) => {
          if (!ok) {
            logger.warn({ stationId }, 'OCPP connection rejected: auth failed');
            cb(false, 401, 'Unauthorized');
            return;
          }
          cb(true);
        })
        .catch((err) => {
          logger.error({ stationId, err }, 'Error verifying OCPP auth');
          cb(false, 500, 'Server error');
        });
    },
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const stationId = extractStationId(req.url);
    if (!stationId) {
      // verifyClient already validated, but guard for type narrowing
      ws.close(1008, 'Station ID required');
      return;
    }

    logger.info({ stationId }, 'Charging station connected');
    connectionManager.register(stationId, ws);

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const raw = data.toString();
      messageRouter.handle(stationId, ws, raw).catch((err) => {
        logger.error({ stationId, err }, 'Unhandled error in messageRouter');
      });
    });

    ws.on('close', (code, reason) => {
      const reasonStr = reason.toString();
      logger.info({ stationId, code, reason: reasonStr }, 'Charging station disconnected');
      connectionManager.unregister(stationId);

      // DB 갱신 + StationOffline Outbox 기록 (원자적)
      prisma.$transaction(async (tx) => {
        await tx.chargingStation.update({
          where: { id: stationId },
          data: { status: 'CommunicationFault' },
        });

        const offlinePayload: StationOfflinePayload = {
          stationId,
          reason: reasonStr || `WebSocket closed (code: ${code})`,
        };

        await writeOutbox(tx, {
          eventType: 'StationOffline',
          aggregateType: 'Station',
          aggregateId: stationId,
          payload: offlinePayload as unknown as Record<string, unknown>,
        });
      }).catch((err) => {
        logger.warn({ stationId, err }, 'Failed to update station status / write StationOffline outbox on disconnect');
      });

      writeOfflineLog(stationId, 'CommunicationFault').catch(() => {});
    });

    ws.on('error', (error) => {
      logger.error({ stationId, error }, 'WebSocket error');
      connectionManager.unregister(stationId);
    });
  });

  logger.info('OCPP WebSocket server initialized');
}
