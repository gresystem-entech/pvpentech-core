import { setTimeout } from 'timers';
import { WebSocket } from 'ws';
import { logger } from '@pvpentech/shared/config/logger';

class ConnectionManager {
  private connections = new Map<string, WebSocket>();

  register(stationId: string, ws: WebSocket): void {
    const existing = this.connections.get(stationId);
    if (existing && existing !== ws) {
      // 기존 연결을 graceful close (1000) 후, 핸드셰이크가 완료되지 않으면 강제 종료.
      // 충전기가 graceful close 없이 재연결하는 경우 stale ws가 남아 서버→충전기
      // 명령이 stale 소켓으로 전송되어 충전기가 받지 못하는 문제를 방지한다.
      logger.warn({ stationId }, 'Duplicate connection — replacing existing OCPP WebSocket');
      try {
        existing.close(1000, 'Replaced by new connection');
      } catch (err) {
        logger.debug({ stationId, err }, 'Error closing existing ws (ignored)');
      }
      setTimeout(() => {
        if (existing.readyState !== WebSocket.CLOSED) {
          existing.terminate();
        }
      }, 1000).unref();
    }
    this.connections.set(stationId, ws);
  }

  unregister(stationId: string): void {
    this.connections.delete(stationId);
  }

  get(stationId: string): WebSocket | undefined {
    return this.connections.get(stationId);
  }

  isConnected(stationId: string): boolean {
    const ws = this.connections.get(stationId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  getConnectedStationIds(): string[] {
    return Array.from(this.connections.keys()).filter((id) => this.isConnected(id));
  }

  getConnectionCount(): number {
    return this.getConnectedStationIds().length;
  }
}

export const connectionManager = new ConnectionManager();
