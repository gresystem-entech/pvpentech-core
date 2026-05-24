/**
 * packages/shared/src/types/events.ts
 *
 * Core → Portal 이벤트 카탈로그 타입 정의 (설계 문서 6-2 기준)
 * Redis Stream Key: csms:core:events
 */

// ─────────────────────────────────────────────
// 공통 이벤트 봉투 (Envelope)
// ─────────────────────────────────────────────

export type CsmsEventType =
  | 'StationOnline'
  | 'StationOffline'
  | 'TransactionStarted'
  | 'TransactionStopped'
  | 'MeterValueUpdate'
  | 'ConnectorStatusChanged'
  | 'FaultRaised'
  | 'FaultCleared'
  | 'FirmwareStatusChanged'
  | 'OcppCommandResultReceived';

export interface CsmsEventEnvelope<T extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;          // UUID v4
  eventType: CsmsEventType;
  occurredAt: string;       // ISO8601
  aggregateType?: string;
  aggregateId?: string;
  payload: T;
}

// ─────────────────────────────────────────────
// 충전소 상태
// ─────────────────────────────────────────────

export interface StationOnlinePayload {
  stationId: string;
  chargePointVendor: string;
  chargePointModel: string;
  firmwareVersion?: string;
}

export interface StationOfflinePayload {
  stationId: string;
  reason?: string;
}

// ─────────────────────────────────────────────
// 트랜잭션
// ─────────────────────────────────────────────

export interface TransactionStartedPayload {
  transactionId: number;
  sessionId: string;
  stationId: string;
  connectorId: number;
  idTag?: string;
  meterStart: number;         // Wh
  timeStart: string;          // ISO8601 — ChargeSessionProjection.timeStart 채우기에 사용
  unitPriceVnd?: number;
  marginRate?: string;        // Decimal string, e.g. "10.00"
  settlementSchedule?: string;
  settlementDay?: number;
  settlementDayOfWeek?: number;
  siteId?: number;            // Core ChargingStation.siteId — Portal Consumer가 partnerId 매핑에 사용
}

export interface TransactionStoppedPayload {
  transactionId: number;
  sessionId: string;
  stationId: string;
  meterStart: number;         // Wh
  meterStop: number;          // Wh
  totalKwh: number;
  costVnd?: number;
  unitPriceVnd?: number;
  timeStart: string;          // ISO8601
  timeEnd: string;            // ISO8601
  reason?: string;
}

// ─────────────────────────────────────────────
// 미터값
// ─────────────────────────────────────────────

export interface MeterValueUpdatePayload {
  transactionId: number;
  sessionId: string;
  stationId: string;
  currentKwh?: number;
  currentW?: number;
}

// ─────────────────────────────────────────────
// 커넥터 상태
// ─────────────────────────────────────────────

export interface ConnectorStatusChangedPayload {
  stationId: string;
  connectorId: number;
  status: string;
  errorCode?: string;
}

// ─────────────────────────────────────────────
// 장애
// ─────────────────────────────────────────────

export interface FaultRaisedPayload {
  stationId: string;
  connectorId?: number;
  errorCode: string;
  info?: string;
}

export interface FaultClearedPayload {
  stationId: string;
  connectorId?: number;
}

// ─────────────────────────────────────────────
// 펌웨어
// ─────────────────────────────────────────────

export interface FirmwareStatusChangedPayload {
  stationId: string;
  status: string;
  campaignId?: number;
  firmwareVersion?: string;
}

// ─────────────────────────────────────────────
// OCPP 명령 결과
// ─────────────────────────────────────────────

export interface OcppCommandResultReceivedPayload {
  stationId: string;
  messageId: string;
  action: string;
  status: string;
  responsePayload?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// 타입 맵 (eventType → payload 타입 조회용)
// ─────────────────────────────────────────────

export interface CsmsEventPayloadMap {
  StationOnline: StationOnlinePayload;
  StationOffline: StationOfflinePayload;
  TransactionStarted: TransactionStartedPayload;
  TransactionStopped: TransactionStoppedPayload;
  MeterValueUpdate: MeterValueUpdatePayload;
  ConnectorStatusChanged: ConnectorStatusChangedPayload;
  FaultRaised: FaultRaisedPayload;
  FaultCleared: FaultClearedPayload;
  FirmwareStatusChanged: FirmwareStatusChangedPayload;
  OcppCommandResultReceived: OcppCommandResultReceivedPayload;
}
