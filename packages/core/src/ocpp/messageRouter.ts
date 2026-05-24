import { WebSocket } from 'ws';
import { parseOcppMessage, serializeCallResult, serializeCallError } from './messageParser';
import { schemaValidator } from './schemaValidator';
import { pendingRequests } from './pendingRequests';
import { handlerMap } from './handlers';
import { logger } from '@pvpentech/shared/config/logger';
import { OcppMessageType, OcppCall, OcppCallResult, OcppCallError } from '../types/ocpp.types';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';

function classifyOcppError(error: unknown): [string, string] {
  if (error instanceof Error) {
    if (error.message.includes('JSON')) return ['ProtocolError', 'Invalid JSON format'];
    if (error.message.includes('Schema') || error.message.includes('Missing required'))
      return ['FormationViolation', 'Schema validation failed'];
    if (error.message.includes('NotImplemented')) return ['NotImplemented', error.message];
  }
  return ['InternalError', 'Internal server error'];
}

class MessageRouter {
  async handle(stationId: string, ws: WebSocket, raw: string): Promise<void> {
    let messageId = 'unknown';
    let action: string | undefined;
    try {
      const message = parseOcppMessage(raw);
      messageId = message.messageId;
      if (message.messageTypeId === OcppMessageType.Call) {
        action = (message as OcppCall).action;
      }

      // 수신 메시지 로그 (CP→CSMS, inbound=true)
      this.logInbound(stationId, message, raw).catch((err) =>
        logger.error({ stationId, err }, 'Failed to log inbound OCPP message')
      );

      if (message.messageTypeId === OcppMessageType.Call) {
        const call = message as OcppCall;
        const payload = call.payload;

        // JSON Schema validation
        const validationError = schemaValidator.validate(action!, payload);
        if (validationError) {
          logger.warn({ stationId, action, validationError }, 'OCPP schema validation failed');
          this.sendAndLog(ws, stationId, serializeCallError(messageId, 'FormationViolation', validationError), {
            direction: OcppMessageType.CallError,
            messageId,
            action,
          });
          return;
        }

        const handler = handlerMap.get(action!);
        if (!handler) {
          logger.warn({ stationId, action }, 'No handler for OCPP action');
          this.sendAndLog(ws, stationId, serializeCallError(messageId, 'NotImplemented', `Action ${action} not supported`), {
            direction: OcppMessageType.CallError,
            messageId,
            action,
          });
          return;
        }

        // Execute handler — returns response payload
        const responsePayload = await handler(stationId, payload);
        this.sendAndLog(ws, stationId, serializeCallResult(messageId, responsePayload), {
          direction: OcppMessageType.CallResult,
          messageId,
          action,
        });
      } else if (message.messageTypeId === OcppMessageType.CallResult) {
        const result = message as OcppCallResult;
        pendingRequests.resolve(messageId, result.payload);
      } else if (message.messageTypeId === OcppMessageType.CallError) {
        const err = message as OcppCallError;
        pendingRequests.reject(messageId, new Error(`${err.errorCode}: ${err.errorDescription}`));
      }
    } catch (error) {
      logger.error({ stationId, error }, 'Error handling OCPP message');

      const [ocppErrorCode, description] = classifyOcppError(error);
      try {
        this.sendAndLog(ws, stationId, serializeCallError(messageId, ocppErrorCode, description), {
          direction: OcppMessageType.CallError,
          messageId,
          action,
        });
      } catch (sendError) {
        logger.error({ stationId, sendError }, 'Failed to send CallError');
      }
    }
  }

  /**
   * CSMS→CP 송신 + 동시에 ocpp_message 에 로그 (inbound=false).
   * - sendCommand 헬퍼(_sender.ts) 가 CSMS 시작 CALL 송신 시 호출
   * - messageRouter 내부 응답 송신 (CallResult / CallError) 시에도 호출
   */
  logOutbound(
    stationId: string,
    raw: string,
    meta: { direction: number; messageId: string; action?: string },
  ): void {
    this.persist(stationId, { ...meta, inbound: false }, raw).catch((err) =>
      logger.error({ stationId, err }, 'Failed to log outbound OCPP message')
    );
  }

  sendAndLog(
    ws: WebSocket,
    stationId: string,
    raw: string,
    meta: { direction: number; messageId: string; action?: string },
  ): void {
    ws.send(raw);
    this.logOutbound(stationId, raw, meta);
  }

  private async logInbound(
    stationId: string,
    message: { messageTypeId: number; messageId: string },
    raw: string,
  ): Promise<void> {
    const action =
      message.messageTypeId === OcppMessageType.Call
        ? (message as OcppCall).action
        : undefined;

    await this.persist(stationId, {
      direction: message.messageTypeId,
      messageId: message.messageId,
      action,
      inbound: true,
    }, raw);
  }

  private async persist(
    stationId: string,
    meta: { direction: number; messageId: string; action?: string; inbound: boolean },
    raw: string,
  ): Promise<void> {
    // Only log if station exists in DB (auto-created on BootNotification)
    const stationExists = await prisma.chargingStation
      .findUnique({ where: { id: stationId }, select: { id: true } })
      .then(Boolean)
      .catch(() => false);
    if (!stationExists) return;

    await prisma.ocppMessage.create({
      data: {
        stationId,
        messageId: meta.messageId,
        direction: meta.direction,
        action: meta.action ?? null,
        payload: raw,
        inbound: meta.inbound,
      },
    });
  }
}

export const messageRouter = new MessageRouter();
