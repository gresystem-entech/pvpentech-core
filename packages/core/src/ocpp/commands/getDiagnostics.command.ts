import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { connectionManager } from '../connectionManager';
import { pendingRequests } from '../pendingRequests';
import { serializeCall } from '../messageParser';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';

interface GetDiagnosticsRequest {
  /** 진단 파일 업로드 대상 URL (FTP/SFTP/HTTPS PUT). 환경변수에서 주입 권장. */
  location: string;
  /** 시작 시각 (옵션, ISO 8601 UTC) */
  startTime?: string;
  /** 종료 시각 (옵션, ISO 8601 UTC) */
  stopTime?: string;
  /** 재시도 횟수 (옵션) */
  retries?: number;
  /** 재시도 간격 초 (옵션) */
  retryInterval?: number;
}

interface GetDiagnosticsResponse {
  /** 충전기가 업로드할 파일명. 응답에 포함되면 DiagnosticsRequest.fileName 에 저장. */
  fileName?: string;
}

/**
 * OCPP 1.6 §5.7 GetDiagnostics.req
 *
 * 진단 파일 업로드를 충전기에 요청. ocpp_command_result 영속화에 더해
 * diagnostics_request 테이블에도 진행 추적용 레코드를 INSERT.
 *
 * 후속 처리:
 *  - GetDiagnostics.conf 응답에 fileName 포함 → diagnostics_request.fileName 갱신
 *  - DiagnosticsStatusNotification (Uploading/Uploaded/UploadFailed) 수신 →
 *    diagnostics_request.status / completedAt 갱신 (handler 측에서 처리)
 *
 * 보안: location URL 의 자격증명은 호출자가 환경변수에서 조립해 전달.
 *       소스에 평문 저장 금지 (REQ-DIAG-001).
 */
export async function sendGetDiagnostics(
  stationId: string,
  params: GetDiagnosticsRequest,
  requestedBy?: string,
): Promise<GetDiagnosticsResponse> {
  const ws = connectionManager.get(stationId);
  if (!ws || ws.readyState !== ws.OPEN) {
    throw new Error(`Station ${stationId} is not connected`);
  }

  const messageId = uuidv4();

  // 1) ocpp_command_result + diagnostics_request 동시 INSERT (트랜잭션)
  await prisma
    .$transaction([
      prisma.ocppCommandResult.create({
        data: {
          messageId,
          stationId,
          action: 'GetDiagnostics',
          status: 'pending',
          requestPayload: params as unknown as Prisma.InputJsonValue,
          requestedBy: requestedBy ?? null,
        },
      }),
      prisma.diagnosticsRequest.create({
        data: {
          messageId,
          stationId,
          status: 'Idle',
          uploadLocation: params.location,
          startTime: params.startTime ? new Date(params.startTime) : null,
          stopTime: params.stopTime ? new Date(params.stopTime) : null,
          retries: params.retries ?? null,
          retryInterval: params.retryInterval ?? null,
          requestedBy: requestedBy ?? null,
        },
      }),
    ])
    .catch((err) => {
      logger.warn({ stationId, messageId, err }, 'Failed to insert pending diagnostics records');
    });

  const responsePromise = pendingRequests.waitFor(messageId);
  ws.send(serializeCall(messageId, 'GetDiagnostics', params));
  logger.info({ stationId, messageId, location: params.location }, 'GetDiagnostics sent');

  try {
    const response = (await responsePromise) as GetDiagnosticsResponse;

    await prisma
      .$transaction([
        prisma.ocppCommandResult.update({
          where: { messageId },
          data: {
            status: 'completed',
            responsePayload: (response ?? {}) as Prisma.InputJsonValue,
            receivedAt: new Date(),
          },
        }),
        prisma.diagnosticsRequest.update({
          where: { messageId },
          data: { fileName: response?.fileName ?? null },
        }),
      ])
      .catch((err) => {
        logger.warn({ messageId, err }, 'Failed to update diagnostics records on completion');
      });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.toLowerCase().includes('timeout');
    let errorCode: string | null = null;
    let errorDescription = message;
    if (!isTimeout) {
      const idx = message.indexOf(':');
      if (idx > 0) {
        errorCode = message.slice(0, idx).trim();
        errorDescription = message.slice(idx + 1).trim();
      }
    }

    await prisma.ocppCommandResult
      .update({
        where: { messageId },
        data: {
          status: isTimeout ? 'timeout' : 'error',
          errorCode,
          errorDescription: errorDescription.slice(0, 500),
          receivedAt: new Date(),
        },
      })
      .catch(() => {});

    // diagnostics_request 는 status='Idle' 그대로 두되, completedAt 으로 종료 시각 기록
    await prisma.diagnosticsRequest
      .update({
        where: { messageId },
        data: { completedAt: new Date() },
      })
      .catch(() => {});

    throw err;
  }
}
