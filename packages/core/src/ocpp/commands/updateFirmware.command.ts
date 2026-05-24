import { sendCommand } from './_sender';

interface UpdateFirmwareRequest {
  /** 펌웨어 다운로드 URL — 충전기가 GET 으로 받아옴. REQ-FW-001 에 따라 호출자가 환경변수 기반으로 조립. */
  location: string;
  /** ISO 8601 UTC. 이 시점 이후 다운로드 시작 (즉시면 now). */
  retrieveDate: string;
  /** 다운로드 재시도 횟수 (옵션) */
  retries?: number;
  /** 재시도 간격 초 (옵션) */
  retryInterval?: number;
}

/**
 * OCPP 1.6 §5.18 UpdateFirmware.req
 * 응답은 빈 객체. 진행 상황은 FirmwareStatusNotification 으로 push.
 */
export async function sendUpdateFirmware(
  stationId: string,
  params: UpdateFirmwareRequest,
  requestedBy?: string,
): Promise<Record<string, unknown>> {
  return sendCommand<Record<string, unknown>>(
    stationId,
    'UpdateFirmware',
    params,
    { requestedBy },
  );
}
