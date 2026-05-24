import { sendCommand } from './_sender';

type RequestedMessage =
  | 'BootNotification'
  | 'DiagnosticsStatusNotification'
  | 'FirmwareStatusNotification'
  | 'Heartbeat'
  | 'MeterValues'
  | 'StatusNotification';

interface TriggerMessageRequest {
  requestedMessage: RequestedMessage;
  /** MeterValues / StatusNotification 트리거 시 특정 커넥터 지정 (선택) */
  connectorId?: number;
}

interface TriggerMessageResponse {
  status: 'Accepted' | 'Rejected' | 'NotImplemented';
}

/**
 * OCPP 1.6 §5.16 TriggerMessage.req
 * 충전기에게 특정 알림을 즉시 송신하도록 트리거.
 * 운영자가 충전기 상태를 강제로 가져올 때 사용 (예: Heartbeat 즉시 받기).
 */
export async function sendTriggerMessage(
  stationId: string,
  params: TriggerMessageRequest,
  requestedBy?: string,
): Promise<TriggerMessageResponse> {
  return sendCommand<TriggerMessageResponse>(
    stationId,
    'TriggerMessage',
    params,
    { requestedBy },
  );
}
