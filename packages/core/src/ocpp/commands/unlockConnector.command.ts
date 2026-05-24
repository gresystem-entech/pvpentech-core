import { sendCommand } from './_sender';

interface UnlockConnectorRequest {
  /** 잠금 해제할 커넥터 ID (1 이상) */
  connectorId: number;
}

interface UnlockConnectorResponse {
  status: 'Unlocked' | 'UnlockFailed' | 'NotSupported';
}

/**
 * OCPP 1.6 §5.17 UnlockConnector.req
 * 케이블이 충전기에 물리적으로 잠겨 빠지지 않을 때 원격 잠금 해제.
 * 일부 충전기는 NotSupported 회신 — 해당 모델은 현장 출동 필요.
 */
export async function sendUnlockConnector(
  stationId: string,
  params: UnlockConnectorRequest,
  requestedBy?: string,
): Promise<UnlockConnectorResponse> {
  return sendCommand<UnlockConnectorResponse>(
    stationId,
    'UnlockConnector',
    params,
    { requestedBy },
  );
}
