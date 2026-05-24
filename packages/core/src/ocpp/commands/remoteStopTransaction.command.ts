import { sendCommand } from './_sender';

interface RemoteStopTransactionRequest {
  transactionId: number;
}

interface RemoteStopTransactionResponse {
  status: 'Accepted' | 'Rejected';
}

export async function sendRemoteStopTransaction(
  stationId: string,
  params: RemoteStopTransactionRequest,
  requestedBy?: string,
): Promise<RemoteStopTransactionResponse> {
  return sendCommand<RemoteStopTransactionResponse>(
    stationId,
    'RemoteStopTransaction',
    params,
    { requestedBy },
  );
}
