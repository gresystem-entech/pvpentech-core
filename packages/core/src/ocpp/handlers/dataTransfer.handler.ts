import { logger } from '@pvpentech/shared/config/logger';

interface DataTransferPayload {
  vendorId: string;
  messageId?: string;
  data?: string;
}

interface DataTransferResponse {
  status: 'Accepted' | 'Rejected' | 'UnknownMessageId' | 'UnknownVendorId';
  data?: string;
}

/**
 * Phase 4-A — DataTransfer 핸들러 레지스트리 (REQ-DT-001).
 *
 * vendor 별 messageId 단위로 핸들러를 분리 등록할 수 있는 레지스트리.
 * 신규 vendor 메시지 추가 시 코어 코드 변경 없이 `register()` 호출만으로 확장.
 */

export type DataTransferSubHandler = (
  stationId: string,
  data: string | undefined,
) => Promise<DataTransferResponse> | DataTransferResponse;

class DataTransferRegistry {
  /** Key 형식: `vendorId::messageId` (messageId 가 없으면 `vendorId::__default__`) */
  private handlers = new Map<string, DataTransferSubHandler>();
  private knownVendorIds = new Set<string>();

  register(vendorId: string, messageId: string | null, handler: DataTransferSubHandler): void {
    const key = this.makeKey(vendorId, messageId);
    if (this.handlers.has(key)) {
      logger.warn({ vendorId, messageId }, 'DataTransfer handler overwritten');
    }
    this.handlers.set(key, handler);
    this.knownVendorIds.add(vendorId);
  }

  resolve(vendorId: string, messageId?: string): DataTransferSubHandler | null {
    if (messageId) {
      const specific = this.handlers.get(this.makeKey(vendorId, messageId));
      if (specific) return specific;
    }
    const fallback = this.handlers.get(this.makeKey(vendorId, null));
    return fallback ?? null;
  }

  isKnownVendor(vendorId: string): boolean {
    return this.knownVendorIds.has(vendorId);
  }

  private makeKey(vendorId: string, messageId: string | null): string {
    return `${vendorId}::${messageId ?? '__default__'}`;
  }
}

export const dataTransferRegistry = new DataTransferRegistry();

/**
 * OCPP 1.6 §5.5 DataTransfer.req 핸들러 (CP→CSMS).
 *
 * 동작 흐름:
 *  1. 등록된 (vendorId, messageId) 핸들러 매칭 → 해당 핸들러 결과 반환
 *  2. vendorId 등록되어 있으나 messageId 매칭 실패 → `UnknownMessageId`
 *  3. vendorId 자체가 등록 안 됨 → `UnknownVendorId`
 *
 * 미등록 vendor 메시지가 와도 CALLERROR 가 아닌 OCPP 표준 status 로 응답하므로
 * 충전기 입장에서 정상적인 흐름. 실제 처리 로직은 `dataTransferRegistry.register()` 로
 * 별도 모듈에서 등록 (코어 코드 수정 불필요).
 */
export async function dataTransferHandler(
  stationId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const p = payload as unknown as DataTransferPayload;
  logger.info(
    { stationId, vendorId: p.vendorId, messageId: p.messageId },
    'DataTransfer received',
  );

  const handler = dataTransferRegistry.resolve(p.vendorId, p.messageId);
  if (handler) {
    try {
      const result = await Promise.resolve(handler(stationId, p.data));
      return result as unknown as Record<string, unknown>;
    } catch (err) {
      logger.error({ stationId, vendorId: p.vendorId, messageId: p.messageId, err }, 'DataTransfer sub-handler error');
      return { status: 'Rejected' };
    }
  }

  // 매칭 실패 — vendor 자체 등록 여부에 따라 분기
  if (dataTransferRegistry.isKnownVendor(p.vendorId)) {
    return { status: 'UnknownMessageId' };
  }
  return { status: 'UnknownVendorId' };
}
