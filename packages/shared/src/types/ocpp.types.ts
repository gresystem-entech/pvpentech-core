// OCPP 1.6 메시지 타입 정의

export enum OcppMessageType {
  Call = 2,
  CallResult = 3,
  CallError = 4,
}

export interface OcppCall {
  messageTypeId: 2;
  messageId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface OcppCallResult {
  messageTypeId: 3;
  messageId: string;
  payload: Record<string, unknown>;
}

export interface OcppCallError {
  messageTypeId: 4;
  messageId: string;
  errorCode: string;
  errorDescription: string;
  errorDetails: Record<string, unknown>;
}

export type OcppMessage = OcppCall | OcppCallResult | OcppCallError;

// OCPP 1.6 Error Codes
export enum OcppErrorCode {
  NotImplemented = 'NotImplemented',
  NotSupported = 'NotSupported',
  InternalError = 'InternalError',
  ProtocolError = 'ProtocolError',
  SecurityError = 'SecurityError',
  FormationViolation = 'FormationViolation',
  PropertyConstraintViolation = 'PropertyConstraintViolation',
  OccurenceConstraintViolation = 'OccurenceConstraintViolation',
  TypeConstraintViolation = 'TypeConstraintViolation',
  GenericError = 'GenericError',
}

// OCPP Action Handler type
export type OcppHandler = (
  stationId: string,
  payload: Record<string, unknown>
) => Promise<Record<string, unknown>>;
