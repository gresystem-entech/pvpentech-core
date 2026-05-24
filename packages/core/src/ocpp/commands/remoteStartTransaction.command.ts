import { sendCommand } from './_sender';

interface RemoteStartTransactionRequest {
  connectorId: number;
  idTag: string;
  chargingProfile?: object;
}

interface RemoteStartTransactionResponse {
  status: 'Accepted' | 'Rejected';
}

export async function sendRemoteStartTransaction(
  stationId: string,
  params: RemoteStartTransactionRequest,
  requestedBy?: string,
): Promise<RemoteStartTransactionResponse> {
  return sendCommand<RemoteStartTransactionResponse>(
    stationId,
    'RemoteStartTransaction',
    params,
    { requestedBy },
  );
}
