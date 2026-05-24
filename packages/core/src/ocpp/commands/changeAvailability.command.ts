import { sendCommand } from './_sender';

interface ChangeAvailabilityRequest {
  connectorId: number;
  type: 'Operative' | 'Inoperative';
}

interface ChangeAvailabilityResponse {
  status: 'Accepted' | 'Rejected' | 'Scheduled';
}

export async function sendChangeAvailability(
  stationId: string,
  params: ChangeAvailabilityRequest,
  requestedBy?: string,
): Promise<ChangeAvailabilityResponse> {
  return sendCommand<ChangeAvailabilityResponse>(
    stationId,
    'ChangeAvailability',
    params,
    { requestedBy },
  );
}
