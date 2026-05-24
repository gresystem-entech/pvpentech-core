import { sendCommand } from './_sender';

interface ResetRequest {
  type: 'Hard' | 'Soft';
}

interface ResetResponse {
  status: 'Accepted' | 'Rejected';
}

export async function sendReset(
  stationId: string,
  params: ResetRequest,
  requestedBy?: string,
): Promise<ResetResponse> {
  return sendCommand<ResetResponse>(stationId, 'Reset', params, { requestedBy });
}
