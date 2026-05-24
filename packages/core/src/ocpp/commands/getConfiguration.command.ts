import { sendCommand } from './_sender';

interface GetConfigurationRequest {
  /** 조회할 키 목록 (생략 시 전체 키 반환) */
  key?: string[];
}

interface ConfigurationKeyEntry {
  key: string;
  readonly: boolean;
  value?: string;
}

interface GetConfigurationResponse {
  configurationKey?: ConfigurationKeyEntry[];
  unknownKey?: string[];
}

/**
 * OCPP 1.6 §5.8 GetConfiguration.req
 * 충전기의 OCPP 설정값(HeartbeatInterval, MeterValueSampleInterval 등)을 조회.
 * 응답은 ocpp_command_result.responsePayload 에 영속화되어 후행 조회 가능.
 */
export async function sendGetConfiguration(
  stationId: string,
  params: GetConfigurationRequest = {},
  requestedBy?: string,
): Promise<GetConfigurationResponse> {
  return sendCommand<GetConfigurationResponse>(
    stationId,
    'GetConfiguration',
    params,
    { requestedBy },
  );
}
