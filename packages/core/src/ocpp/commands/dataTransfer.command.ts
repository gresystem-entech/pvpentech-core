import { sendCommand } from './_sender';

interface DataTransferRequest {
  vendorId: string;
  messageId?: string;
  data?: string;
}

interface DataTransferResponse {
  status: 'Accepted' | 'Rejected' | 'UnknownMessageId' | 'UnknownVendorId';
  data?: string;
}

/**
 * OCPP 1.6 §5.5 DataTransfer.req (CSMS → CP)
 * 충전기에 vendor 확장 메시지를 송신. 응답은 ocpp_command_result 에 영속화.
 */
export async function sendDataTransfer(
  stationId: string,
  params: DataTransferRequest,
  requestedBy?: string,
): Promise<DataTransferResponse> {
  return sendCommand<DataTransferResponse>(
    stationId,
    'DataTransfer',
    params,
    { requestedBy },
  );
}
