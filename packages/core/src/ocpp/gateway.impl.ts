/**
 * OcppGatewayImpl — IOcppGateway 기본 구현체 (모놀리스 내부 직접 호출 방식).
 *
 * 내부적으로 기존 sendCommand 계열 함수와 connectionManager 를 그대로 사용한다.
 * Phase 2에서 CSMS-Core / CSMS-Portal 분리 시 이 파일을 CoreApiGatewayImpl(HTTP 호출)로
 * 교체하면 된다. 인터페이스(gateway.interface.ts)와 호출부(charge.service.ts 등)는
 * 변경 불필요.
 */

import { v4 as uuidv4 } from 'uuid';
import { connectionManager } from './connectionManager';
import { serializeCall } from './messageParser';
import { sendRemoteStartTransaction } from './commands/remoteStartTransaction.command';
import { sendRemoteStopTransaction } from './commands/remoteStopTransaction.command';
import { sendReset } from './commands/reset.command';
import { sendChangeAvailability } from './commands/changeAvailability.command';
import { sendUpdateFirmware } from './commands/updateFirmware.command';
import type {
  IOcppGateway,
  AcceptedOrRejected,
  AcceptedRejectedOrScheduled,
} from './gateway.interface';

export class OcppGatewayImpl implements IOcppGateway {
  // ─── 연결 상태 조회 ─────────────────────────────────────────

  isStationConnected(stationId: string): boolean {
    return connectionManager.isConnected(stationId);
  }

  getConnectedStationIds(): string[] {
    return connectionManager.getConnectedStationIds();
  }

  // ─── 충전 제어 ───────────────────────────────────────────────

  async startSession(params: {
    stationId: string;
    connectorId: number;
    idTag: string;
    chargingProfile?: object;
    requestedBy?: string;
  }): Promise<AcceptedOrRejected> {
    const { stationId, connectorId, idTag, chargingProfile, requestedBy } = params;
    return sendRemoteStartTransaction(
      stationId,
      { connectorId, idTag, ...(chargingProfile ? { chargingProfile } : {}) },
      requestedBy,
    );
  }

  async stopSession(params: {
    stationId: string;
    transactionId: number;
    requestedBy?: string;
  }): Promise<AcceptedOrRejected> {
    const { stationId, transactionId, requestedBy } = params;
    return sendRemoteStopTransaction(stationId, { transactionId }, requestedBy);
  }

  // ─── 충전기 관리 명령 ────────────────────────────────────────

  async resetStation(params: {
    stationId: string;
    type: 'Hard' | 'Soft';
    requestedBy?: string;
  }): Promise<AcceptedOrRejected> {
    const { stationId, type, requestedBy } = params;
    return sendReset(stationId, { type }, requestedBy);
  }

  async changeAvailability(params: {
    stationId: string;
    connectorId: number;
    type: 'Operative' | 'Inoperative';
    requestedBy?: string;
  }): Promise<AcceptedRejectedOrScheduled> {
    const { stationId, connectorId, type, requestedBy } = params;
    return sendChangeAvailability(stationId, { connectorId, type }, requestedBy);
  }

  async updateFirmware(params: {
    stationId: string;
    location: string;
    retrieveDate: string;
    retries?: number;
    retryInterval?: number;
    requestedBy?: string;
  }): Promise<Record<string, unknown>> {
    const { stationId, location, retrieveDate, retries, retryInterval, requestedBy } = params;
    return sendUpdateFirmware(
      stationId,
      { location, retrieveDate, retries, retryInterval },
      requestedBy,
    );
  }

  // ─── 로우-레벨 fire-and-forget ───────────────────────────────

  sendRawCall(params: {
    stationId: string;
    action: string;
    payload: object;
  }): { messageId: string } | null {
    const { stationId, action, payload } = params;
    const ws = connectionManager.get(stationId);
    if (!ws || ws.readyState !== ws.OPEN) {
      return null;
    }
    const messageId = uuidv4();
    ws.send(serializeCall(messageId, action, payload));
    return { messageId };
  }

  forceDisconnect(stationId: string): void {
    const ws = connectionManager.get(stationId);
    if (ws) {
      ws.terminate();
      connectionManager.unregister(stationId);
    }
  }
}

/** 싱글톤 인스턴스 — 모든 Portal / 서비스 레이어가 이 인스턴스를 참조한다. */
export const ocppGateway: IOcppGateway = new OcppGatewayImpl();
