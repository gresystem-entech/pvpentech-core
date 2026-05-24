import { sendCommand } from './_sender';

interface ClearCacheResponse {
  status: 'Accepted' | 'Rejected';
}

/**
 * OCPP 1.6 §5.4 ClearCache.req
 * 충전기의 Authorization Cache (idTag 캐시) 를 초기화.
 * 페이로드 없음. RFID 권한 정책 변경 직후 즉시 반영하기 위한 운영 명령.
 */
export async function sendClearCache(
  stationId: string,
  requestedBy?: string,
): Promise<ClearCacheResponse> {
  return sendCommand<ClearCacheResponse>(stationId, 'ClearCache', {}, { requestedBy });
}
