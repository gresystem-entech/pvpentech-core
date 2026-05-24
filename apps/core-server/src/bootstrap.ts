/**
 * apps/core-server/src/bootstrap.ts
 *
 * Core 전용 진입점 부팅 함수.
 * apps/server (legacy) 도 이 함수를 import 하여 Core 부팅을 위임한다.
 */

import http from 'http';
import { logger } from '@pvpentech/shared/config/logger';
import { createCoreApp } from '@pvpentech/core/app';
import { setupCoreInfra } from '@pvpentech/core/bootstrap';

export interface CoreBootstrapHandle {
  shutdown: () => Promise<void>;
}

/**
 * Core HTTP 서버를 지정 포트에서 기동하고 shutdown handle 을 반환한다.
 *
 * @param port - Core HTTP 서버가 listen 할 포트 번호 (기본 3001)
 */
export async function bootstrapCore(port: number): Promise<CoreBootstrapHandle> {
  const app = createCoreApp();
  const httpServer = http.createServer(app);

  // OCPP WebSocket + Outbox Relay + Core Jobs 기동
  const { shutdown: shutdownInfra } = await setupCoreInfra(httpServer);

  return new Promise<CoreBootstrapHandle>((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, () => {
      logger.info({ port }, '[Core] HTTP server listening');
      resolve({
        shutdown: async () => {
          logger.info('[Core] Stopping HTTP server...');
          await shutdownInfra();
          await new Promise<void>((r, e) =>
            httpServer.close((err) => (err ? e(err) : r()))
          );
          logger.info('[Core] HTTP server stopped');
        },
      });
    });
  });
}
