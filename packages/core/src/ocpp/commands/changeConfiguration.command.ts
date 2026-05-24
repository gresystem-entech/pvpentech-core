import { sendCommand } from './_sender';

interface ChangeConfigurationRequest {
  /** 변경할 OCPP 설정 키 (CiString50) */
  key: string;
  /** 새 값 (string, 최대 500자) */
  value: string;
}

interface ChangeConfigurationResponse {
  status: 'Accepted' | 'Rejected' | 'RebootRequired' | 'NotSupported';
}

/**
 * OCPP 1.6 §5.3 ChangeConfiguration.req
 * 충전기의 OCPP 설정값을 변경.
 * 일부 키는 RebootRequired 응답이 와서 재부팅 후 적용됨.
 */
export async function sendChangeConfiguration(
  stationId: string,
  params: ChangeConfigurationRequest,
  requestedBy?: string,
): Promise<ChangeConfigurationResponse> {
  return sendCommand<ChangeConfigurationResponse>(
    stationId,
    'ChangeConfiguration',
    params,
    { requestedBy },
  );
}
