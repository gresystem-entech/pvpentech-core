import { OcppCall, OcppCallResult, OcppCallError, OcppMessage, OcppMessageType } from '../types/ocpp.types';

export function parseOcppMessage(raw: string): OcppMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON');
  }

  if (!Array.isArray(parsed) || parsed.length < 3) {
    throw new Error('Invalid OCPP message format');
  }

  const [messageTypeId] = parsed;

  switch (messageTypeId) {
    case OcppMessageType.Call:
      return {
        messageTypeId: 2,
        messageId: parsed[1] as string,
        action: parsed[2] as string,
        payload: (parsed[3] ?? {}) as Record<string, unknown>,
      } as OcppCall;
    case OcppMessageType.CallResult:
      return {
        messageTypeId: 3,
        messageId: parsed[1] as string,
        payload: (parsed[2] ?? {}) as Record<string, unknown>,
      } as OcppCallResult;
    case OcppMessageType.CallError:
      return {
        messageTypeId: 4,
        messageId: parsed[1] as string,
        errorCode: parsed[2] as string,
        errorDescription: parsed[3] as string,
        errorDetails: (parsed[4] ?? {}) as Record<string, unknown>,
      } as OcppCallError;
    default:
      throw new Error(`Unknown message type: ${messageTypeId}`);
  }
}

export function serializeCallResult(messageId: string, payload: object): string {
  return JSON.stringify([3, messageId, payload]);
}

export function serializeCallError(
  messageId: string,
  errorCode: string,
  errorDescription: string
): string {
  return JSON.stringify([4, messageId, errorCode, errorDescription, {}]);
}

export function serializeCall(messageId: string, action: string, payload: object): string {
  return JSON.stringify([2, messageId, action, payload]);
}
