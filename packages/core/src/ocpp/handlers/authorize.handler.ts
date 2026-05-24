import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { logger } from '@pvpentech/shared/config/logger';

interface AuthorizePayload {
  idTag: string;
}

interface IdTagInfo {
  status: string;
  expiryDate?: string; // ISO 8601 UTC
  parentIdTag?: string;
}

/**
 * OCPP 1.6 §5.2 Authorize.req 핸들러.
 *
 * 응답 idTagInfo:
 *  - status: Accepted | Blocked | Expired | Invalid | ConcurrentTx
 *  - expiryDate: 카드 만료일 (있으면 충전기가 캐시·표시에 활용)
 *  - parentIdTag: 부모 카드 (현행 단계에서는 미사용 → 미반환)
 */
export async function authorizeHandler(
  stationId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const p = payload as unknown as AuthorizePayload;
  logger.info({ stationId, idTag: p.idTag }, 'Authorize received');

  const idToken = await prisma.idToken.findUnique({
    where: { idTag: p.idTag },
  });

  let status = 'Invalid';
  if (idToken) {
    if (idToken.status === 'Accepted') {
      if (idToken.expiryDate && new Date() > idToken.expiryDate) {
        status = 'Expired';
      } else {
        status = 'Accepted';
      }
    } else {
      status = idToken.status;
    }
  }

  const idTagInfo: IdTagInfo = { status };
  if (idToken?.expiryDate) {
    idTagInfo.expiryDate = idToken.expiryDate.toISOString();
  }

  return { idTagInfo };
}
