/**
 * IOcppGateway — OCPP 통신 추상화 인터페이스
 *
 * Portal / 서비스 레이어가 OCPP 구현 세부사항(WebSocket, connectionManager,
 * pendingRequests 등)을 알지 않고도 충전기와 통신할 수 있도록 하는 경계 인터페이스.
 *
 * Phase 2에서 CoreApiGatewayImpl(HTTP 호출)로 교체할 단일 지점.
 * 교체 시 이 파일의 인터페이스 시그니처는 유지하고 gateway.impl.ts 만 변경하면 된다.
 */

// ─────────────────────────────────────────────
// 공통 타입
// ─────────────────────────────────────────────

export interface AcceptedOrRejected {
  status: 'Accepted' | 'Rejected';
}

export interface AcceptedRejectedOrScheduled {
  status: 'Accepted' | 'Rejected' | 'Scheduled';
}

// ─────────────────────────────────────────────
// IOcppGateway
// ─────────────────────────────────────────────

export interface IOcppGateway {
  // ─── 연결 상태 조회 ───────────────────────────

  /** 충전기 WebSocket 연결 상태 확인 */
  isStationConnected(stationId: string): boolean;

  /** 현재 연결된(OPEN) 모든 충전기 ID 목록 반환 */
  getConnectedStationIds(): string[];

  // ─── 충전 제어 ────────────────────────────────

  /**
   * 원격 충전 시작 명령 (RemoteStartTransaction).
   * OCPP 1.6 §5.11
   */
  startSession(params: {
    stationId: string;
    connectorId: number;
    idTag: string;
    chargingProfile?: object;
    requestedBy?: string;
  }): Promise<AcceptedOrRejected>;

  /**
   * 원격 충전 중지 명령 (RemoteStopTransaction).
   * OCPP 1.6 §5.12
   */
  stopSession(params: {
    stationId: string;
    transactionId: number;
    requestedBy?: string;
  }): Promise<AcceptedOrRejected>;

  // ─── 충전기 관리 명령 ─────────────────────────

  /**
   * 충전기 리셋 (Reset — Soft / Hard).
   * OCPP 1.6 §5.10
   */
  resetStation(params: {
    stationId: string;
    type: 'Hard' | 'Soft';
    requestedBy?: string;
  }): Promise<AcceptedOrRejected>;

  /**
   * 커넥터/충전기 가용성 변경 (ChangeAvailability).
   * OCPP 1.6 §5.2
   */
  changeAvailability(params: {
    stationId: string;
    connectorId: number;
    type: 'Operative' | 'Inoperative';
    requestedBy?: string;
  }): Promise<AcceptedRejectedOrScheduled>;

  /**
   * 펌웨어 업데이트 명령 (UpdateFirmware).
   * OCPP 1.6 §5.18 — 응답은 빈 객체. 진행 상황은 FirmwareStatusNotification 으로 push.
   */
  updateFirmware(params: {
    stationId: string;
    location: string;
    retrieveDate: string;
    retries?: number;
    retryInterval?: number;
    requestedBy?: string;
  }): Promise<Record<string, unknown>>;

  /**
   * 로우-레벨 fire-and-forget OCPP CALL 송신.
   * 응답 대기 없이 메시지만 전송한다 (진단 요청 등 응답이 없는 명령에 사용).
   * 충전기가 오프라인이면 null 반환.
   */
  sendRawCall(params: {
    stationId: string;
    action: string;
    payload: object;
  }): { messageId: string } | null;

  /**
   * 충전기 WebSocket 연결을 강제 종료하고 connectionManager 에서 제거한다.
   * 재-프로비저닝 시 구 기기를 즉시 퇴출시키는 데 사용.
   * 연결이 없으면 no-op.
   */
  forceDisconnect(stationId: string): void;
}
