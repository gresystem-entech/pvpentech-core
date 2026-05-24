/**
 * Internal API 에러 코드 및 에러 클래스 (Phase 2-B)
 *
 * Portal → Core HTTP 호출 시 발생하는 에러를 표준화한다.
 * 에러 응답 형식: { error: { code, message } }
 *
 * 기존 AppError 체계와 호환: InternalApiError extends AppError 이므로
 * errorHandlerMiddleware 가 자동으로 올바른 HTTP 상태코드와 형식으로 응답한다.
 */

import { AppError } from './index';

// ─── 에러 코드 타입 ────────────────────────────────────────────────────────────

export type InternalApiErrorCode =
  | 'STATION_NOT_FOUND'   // 404 — 충전기 ID 존재하지 않음
  | 'STATION_OFFLINE'     // 422 — 충전기가 OCPP WebSocket 미연결 상태
  | 'OCPP_TIMEOUT'        // 504 — 충전기가 OCPP 응답 시간 내에 응답하지 않음
  | 'OCPP_REJECTED'       // 422 — 충전기가 명령을 Rejected 로 응답
  | 'DUPLICATE_REQUEST'   // 409 — Idempotency-Key 중복 처리 중 (재시도 가능)
  | 'UNAUTHORIZED'        // 401 — Bearer 토큰 인증 실패
  | 'BAD_REQUEST'         // 400 — 요청 본문/쿼리 유효성 오류
  | 'NOT_FOUND'           // 404 — 리소스를 찾을 수 없음
  | 'CONFLICT'            // 409 — 비즈니스 충돌 (이미 존재하거나 삭제 불가 상태)
  | 'INTERNAL_ERROR';     // 500 — 예상치 못한 서버 에러

// ─── 에러 클래스 ──────────────────────────────────────────────────────────────

export class InternalApiError extends AppError {
  constructor(
    public readonly code: InternalApiErrorCode,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message, httpStatus, code);
    this.name = 'InternalApiError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── 팩토리 헬퍼 ─────────────────────────────────────────────────────────────

export const InternalApiErrors = {
  stationNotFound: (stationId: string) =>
    new InternalApiError('STATION_NOT_FOUND', 404, `Station '${stationId}' not found`),

  stationOffline: (stationId: string) =>
    new InternalApiError('STATION_OFFLINE', 422, `Station '${stationId}' is offline`),

  ocppTimeout: (stationId: string, action: string) =>
    new InternalApiError('OCPP_TIMEOUT', 504, `OCPP command '${action}' timed out for station '${stationId}'`),

  ocppRejected: (stationId: string, action: string) =>
    new InternalApiError('OCPP_REJECTED', 422, `OCPP command '${action}' was rejected by station '${stationId}'`),

  duplicateRequest: (idempotencyKey: string) =>
    new InternalApiError('DUPLICATE_REQUEST', 409, `Request with Idempotency-Key '${idempotencyKey}' is already being processed`),

  unauthorized: (reason = 'Invalid or missing Bearer token') =>
    new InternalApiError('UNAUTHORIZED', 401, reason),

  badRequest: (message: string) =>
    new InternalApiError('BAD_REQUEST', 400, message),

  notFound: (message: string) =>
    new InternalApiError('NOT_FOUND', 404, message),

  conflict: (message: string) =>
    new InternalApiError('CONFLICT', 409, message),

  internalError: (message = 'Internal server error') =>
    new InternalApiError('INTERNAL_ERROR', 500, message),
} as const;
