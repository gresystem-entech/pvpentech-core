import { WebSocket } from 'ws';
import { logger } from '@pvpentech/shared/config/logger';

class ConnectionManager {
  private connections = new Map<string, WebSocket>();

  register(stationId: string, ws: WebSocket): void {
    if (this.connections.has(stationId)) {
      // 기존 연결 종료 후 재등록 (재연결 시)
      const existing = this.connections.get(stationId)!;
      existing.terminate();
      logger.warn({ stationId }, 'Duplicate connection — old connection terminated');
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
