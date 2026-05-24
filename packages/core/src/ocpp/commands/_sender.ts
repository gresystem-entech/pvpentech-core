import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { connectionManager } from '../connectionManager';
import { pendingRequests } from '../pendingRequests';
import { serializeCall } from '../messageParser';
import { messageRouter } from '../messageRouter';
import { OcppMessageType } from '../../types/ocpp.types';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';
import { writeOutbox } from '../../outbox/outboxWriter';
import type { OcppCommandResultReceivedPayload } from '@pvpentech/shared/types/events';

interface SendCommandOptions {
  /** 발송자 식별자 (CS 운영자 username 등). 감사 로그 용도. */
  requestedBy?: string;
}

/**
 * CSMS → CP OCPP 명령을 송신하고 응답을 기다리는 공통 헬퍼.
 *
 * 동작:
 *  1. UUID 발급 → ocpp_command_result 에 status=pending INSERT
 *  2. WebSocket 으로 CALL 송신
 *  3. pendingRequests 로 응답 대기
 *  4. 정상 수신 → status=completed + responsePayload UPDATE, 결과 반환
 *  5. CallError 수신 → status=error + errorCode/errorDescription UPDATE, throw
 *  6. 타임아웃 → status=timeout UPDATE, throw
 *
 * 모든 빌더는 이 헬퍼를 통해 명령을 송신하므로 응답 영속화가 자동 적용된다.
 */
export async function sendCommand<TResponse>(
  stationId: string,
  action: string,
  payload: object,
  options: SendCommandOptions = {},
): Promise<TResponse> {
  const ws = connectionManager.get(stationId);
  if (!ws || ws.readyState !== ws.OPEN) {
    throw new Error(`Station ${stationId} is not connected`);
  }

  const messageId = uuidv4();

  // 1) pending 레코드 생성 — 송신 직전에 기록하여 송신 실패도 추적 가능
  await prisma.ocppCommandResult
    .create({
      data: {
        messageId,
        stationId,
        action,
        status: 'pending',
        requestPayload: payload as Prisma.InputJsonValue,
        requestedBy: options.requestedBy ?? null,
      },
    })
    .catch((err) => {
      // DB 기록 실패해도 OCPP 명령 자체는 보내야 하므로 로그만 남기고 진행
      logger.warn({ stationId, action, err }, 'Failed to insert ocpp_command_result(pending)');
    });

  // 2) 응답 대기 등록 (메시지 송신 전에 등록해야 race 방지)
  const responsePromise = pendingRequests.waitFor(messageId);

  // 3) CALL 송신 + ocpp_message 로그 (inbound=false, direction=2)
  const message = serializeCall(messageId, action, payload);
  messageRouter.sendAndLog(ws, stationId, message, {
    direction: OcppMessageType.Call,
    messageId,
    action,
  });
  logger.info({ stationId, messageId, action }, `${action} sent`);

  // 4) 응답 처리
  try {
    const response = await responsePromise;
    const responseObj = (response ?? {}) as Record<string, unknown>;

    // ocpp_command_result 갱신 + OcppCommandResultReceived Outbox 기록 (원자적)
    await prisma.$transaction(async (tx) => {
      await tx.ocppCommandResult.update({
        where: { messageId },
        data: {
          status: 'completed',
          responsePayload: responseObj as Prisma.InputJsonValue,
          receivedAt: new Date(),
        },
      });

      // 응답 상태 추출 (대부분 OCPP 명령은 { status: 'Accepted' | ... } 형태)
      const resultStatus = typeof responseObj.status === 'string' ? responseObj.status : 'Accepted';

      const resultPayload: OcppCommandResultReceivedPayload = {
        stationId,
        messageId,
        action,
        status: resultStatus,
        responsePayload: responseObj,
      };

      await writeOutbox(tx, {
        eventType: 'OcppCommandResultReceived',
        aggregateType: 'OcppCommand',
        aggregateId: messageId,
        payload: resultPayload as unknown as Record<string, unknown>,
      });
    }).catch((err) => {
      logger.warn({ messageId, err }, 'Failed to update ocpp_command_result(completed) or write Outbox');
    });

    return response as TResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.toLowerCase().includes('timeout');

    // CallError 형식: "ErrorCode: ErrorDescription" (messageRouter 가 그렇게 만듦)
    let errorCode: string | null = null;
    let errorDescription: string = message;
    if (!isTimeout) {
      const colonIdx = message.indexOf(':');
      if (colonIdx > 0) {
        errorCode = message.slice(0, colonIdx).trim();
        errorDescription = message.slice(colonIdx + 1).trim();
      }
    }

    const finalStatus = isTimeout ? 'timeout' : 'error';

    // ocpp_command_result 갱신 + OcppCommandResultReceived Outbox 기록 (원자적)
    await prisma.$transaction(async (tx) => {
      await tx.ocppCommandResult.update({
        where: { messageId },
        data: {
          status: finalStatus,
          errorCode,
          errorDescription: errorDescription.slice(0, 500),
          receivedAt: new Date(),
        },
      });

      const resultPayload: OcppCommandResultReceivedPayload = {
        stationId,
        messageId,
        action,
        status: finalStatus,
        responsePayload: { errorCode, errorDescription },
      };

      await writeOutbox(tx, {
        eventType: 'OcppCommandResultReceived',
        aggregateType: 'OcppCommand',
        aggregateId: messageId,
        payload: resultPayload as unknown as Record<string, unknown>,
      });
    }).catch((updateErr) => {
      logger.warn({ messageId, updateErr }, 'Failed to update ocpp_command_result(error/timeout) or write Outbox');
    });

    throw err;
  }
}
