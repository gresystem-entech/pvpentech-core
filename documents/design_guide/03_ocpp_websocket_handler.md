# 03. OCPP 1.6 WebSocket 핸들러 설계 가이드

- **버전**: v1.0
- **작성일**: 2026-03-31
- **대상**: Node.js 백엔드 개발자
- **참조**: OCPP 1.6 Specification, `design_ref/01_csms_development_guide.md`, `design_ref/04_message_broker_architecture.md`

---

## 1. 개요 (Overview)

OCPP 1.6 프로토콜 기반으로 충전기(Charge Point, CP)와 CSMS(Central System) 간 WebSocket 통신을 처리하는 모듈 설계를 정의합니다.

### 주요 책임

- CP의 WebSocket 연결 수락 및 인증 (Basic Auth)
- OCPP 메시지 파싱 및 JSON Schema 유효성 검사
- Action별 핸들러 라우팅
- CSMS → CP 명령 전송 및 응답 대기
- 연결 상태 관리 (Heartbeat, 재연결)
- OCPP 메시지 전체 로깅

### OCPP 메시지 형식

```
Call:        [2, "<MessageId>", "<Action>", {<payload>}]
CallResult:  [3, "<MessageId>", {<payload>}]
CallError:   [4, "<MessageId>", "<ErrorCode>", "<ErrorDescription>", {<errorDetails>}]
```

---

## 2. 아키텍처 (Architecture)

```
충전기 (CP)
    │
    │ wss://<domain>/ocpp/<stationId>
    │ Sec-WebSocket-Protocol: ocpp1.6
    │ Authorization: Basic <base64>
    ▼
┌─────────────────────────────────────────────────────┐
│              OCPP WebSocket Server                   │
│                                                     │
│  ┌──────────────┐    ┌──────────────────────────┐  │
│  │ Connection   │    │   Message Parser          │  │
│  │ Manager      │    │   (파싱 / 직렬화)          │  │
│  │ (Map 관리)    │    └──────────────────────────┘  │
│  └──────────────┘                │                  │
│                                  ▼                  │
│                     ┌──────────────────────────┐   │
│                     │   Schema Validator        │   │
│                     │   (Zod / JSON Schema)     │   │
│                     └──────────────────────────┘   │
│                                  │                  │
│                                  ▼                  │
│                     ┌──────────────────────────┐   │
│                     │   Message Router          │   │
│                     │   (Action → Handler)      │   │
│                     └──────────────────────────┘   │
│                          │              │           │
│              ┌───────────┘              └───────────┐│
│              ▼                                      ▼│
│  ┌──────────────────────┐    ┌─────────────────────┐│
│  │  Upstream Handlers   │    │  Pending Requests   ││
│  │  (CP → CSMS)         │    │  (CSMS → CP 응답     ││
│  │  BootNotification    │    │   대기 Map)          ││
│  │  Heartbeat           │    └─────────────────────┘│
│  │  StatusNotification  │                           │
│  │  StartTransaction    │                           │
│  │  StopTransaction     │                           │
│  │  Authorize           │                           │
│  │  MeterValues         │                           │
│  └──────────────────────┘                           │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
              Service Layer
              Repository Layer → PostgreSQL
```

---

## 3. 디렉토리 구조

```
src/ocpp/
├── server.ts                    # WebSocket 서버 초기화
├── connectionManager.ts         # CP 연결 Map 관리
├── messageParser.ts             # 메시지 파싱/직렬화
├── messageRouter.ts             # Action → Handler 라우팅
├── schemaValidator.ts           # OCPP JSON Schema 검증
├── pendingRequests.ts           # 응답 대기 관리
├── handlers/
│   ├── index.ts                 # 핸들러 등록
│   ├── bootNotification.handler.ts
│   ├── heartbeat.handler.ts
│   ├── statusNotification.handler.ts
│   ├── startTransaction.handler.ts
│   ├── stopTransaction.handler.ts
│   ├── authorize.handler.ts
│   ├── meterValues.handler.ts
│   └── dataTransfer.handler.ts
└── commands/
    ├── index.ts
    ├── remoteStartTransaction.command.ts
    ├── remoteStopTransaction.command.ts
    ├── reset.command.ts
    └── changeAvailability.command.ts
```

---

## 4. 구현 가이드

### 4.1 WebSocket 서버 초기화 (`src/ocpp/server.ts`)

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { connectionManager } from './connectionManager';
import { messageRouter } from './messageRouter';
import { logger } from '@config/logger';
import { verifyBasicAuth } from '@utils/auth';

export function initOcppWebSocketServer(server: http.Server): void {
  const wss = new WebSocketServer({
    server,
    path: '/ocpp',
    handleProtocols: (protocols) => {
      // OCPP 1.6 subprotocol 협상
      if (protocols.has('ocpp1.6')) return 'ocpp1.6';
      return false;
    },
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    // URL에서 stationId 추출: /ocpp/<stationId>
    const stationId = req.url?.split('/').pop();
    if (!stationId) {
      ws.close(1008, 'Station ID required');
      return;
    }

    // Basic Auth 검증 (OCPP Security Profile 1)
    const authHeader = req.headers['authorization'];
    if (!verifyBasicAuth(stationId, authHeader)) {
      logger.warn({ stationId }, 'OCPP connection rejected: auth failed');
      ws.close(1008, 'Unauthorized');
      return;
    }

    logger.info({ stationId }, 'Charging station connected');
    connectionManager.register(stationId, ws);

    ws.on('message', (data: Buffer) => {
      messageRouter.handle(stationId, ws, data.toString());
    });

    ws.on('close', () => {
      logger.info({ stationId }, 'Charging station disconnected');
      connectionManager.unregister(stationId);
    });

    ws.on('error', (error) => {
      logger.error({ stationId, error }, 'WebSocket error');
      connectionManager.unregister(stationId);
    });
  });

  logger.info('OCPP WebSocket server initialized on path /ocpp/:stationId');
}
```

### 4.2 연결 관리자 (`src/ocpp/connectionManager.ts`)

```typescript
import { WebSocket } from 'ws';
import { logger } from '@config/logger';

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
    return Array.from(this.connections.keys()).filter((id) =>
      this.isConnected(id)
    );
  }
}

export const connectionManager = new ConnectionManager();
```

### 4.3 메시지 파서 (`src/ocpp/messageParser.ts`)

```typescript
import { OcppCall, OcppCallResult, OcppCallError, OcppMessageType } from '@types/ocpp.types';

export type OcppMessage = OcppCall | OcppCallResult | OcppCallError;

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
      return { messageTypeId: 2, messageId: parsed[1], action: parsed[2], payload: parsed[3] ?? {} };
    case OcppMessageType.CallResult:
      return { messageTypeId: 3, messageId: parsed[1], payload: parsed[2] };
    case OcppMessageType.CallError:
      return { messageTypeId: 4, messageId: parsed[1], errorCode: parsed[2], errorDescription: parsed[3], errorDetails: parsed[4] ?? {} };
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
```

### 4.4 메시지 라우터 (`src/ocpp/messageRouter.ts`)

```typescript
import { WebSocket } from 'ws';
import { parseOcppMessage, serializeCallResult, serializeCallError } from './messageParser';
import { schemaValidator } from './schemaValidator';
import { pendingRequests } from './pendingRequests';
import { handlerMap } from './handlers';
import { ocppMessageService } from '@services/ocppMessage.service';
import { logger } from '@config/logger';
import { OcppMessageType } from '@types/ocpp.types';

class MessageRouter {
  async handle(stationId: string, ws: WebSocket, raw: string): Promise<void> {
    let messageId = 'unknown';
    try {
      const message = parseOcppMessage(raw);
      messageId = message.messageId;

      // OCPP 메시지 로깅 (CP → CSMS 방향)
      await ocppMessageService.log({
        stationId,
        messageId: message.messageId,
        direction: message.messageTypeId,
        action: message.messageTypeId === 2 ? (message as any).action : undefined,
        payload: raw,
      });

      if (message.messageTypeId === OcppMessageType.Call) {
        // Upstream: CP → CSMS 요청 처리
        const { action, payload } = message as any;

        // JSON Schema 검증
        const validationError = schemaValidator.validate(action, payload);
        if (validationError) {
          logger.warn({ stationId, action, validationError }, 'OCPP schema validation failed');
          ws.send(serializeCallError(messageId, 'FormationViolation', validationError));
          return;
        }

        const handler = handlerMap.get(action);
        if (!handler) {
          logger.warn({ stationId, action }, 'No handler for OCPP action');
          ws.send(serializeCallError(messageId, 'NotImplemented', `Action ${action} not supported`));
          return;
        }

        // 핸들러 실행 — 응답 페이로드 반환
        const responsePayload = await handler(stationId, payload);
        ws.send(serializeCallResult(messageId, responsePayload));

      } else if (message.messageTypeId === OcppMessageType.CallResult) {
        // Downstream 응답 처리 (CSMS가 보낸 명령에 대한 CP 응답)
        pendingRequests.resolve(messageId, (message as any).payload);

      } else if (message.messageTypeId === OcppMessageType.CallError) {
        // Downstream 명령 에러 응답
        const { errorCode, errorDescription } = message as any;
        pendingRequests.reject(messageId, new Error(`${errorCode}: ${errorDescription}`));
      }

    } catch (error) {
      logger.error({ stationId, error }, 'Error handling OCPP message');
      ws.send(serializeCallError(messageId, 'InternalError', 'Internal server error'));
    }
  }
}

export const messageRouter = new MessageRouter();
```

### 4.5 응답 대기 관리 (`src/ocpp/pendingRequests.ts`)

CSMS가 CP로 명령을 보내고 응답을 기다리는 패턴입니다.

```typescript
interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const RESPONSE_TIMEOUT_MS = 30_000; // 30초

class PendingRequests {
  private pending = new Map<string, PendingRequest>();

  waitFor(messageId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error(`OCPP response timeout for messageId: ${messageId}`));
      }, RESPONSE_TIMEOUT_MS);

      this.pending.set(messageId, { resolve, reject, timer });
    });
  }

  resolve(messageId: string, payload: unknown): void {
    const pending = this.pending.get(messageId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(messageId);
      pending.resolve(payload);
    }
  }

  reject(messageId: string, error: Error): void {
    const pending = this.pending.get(messageId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(messageId);
      pending.reject(error);
    }
  }
}

export const pendingRequests = new PendingRequests();
```

### 4.6 핸들러 예시: BootNotification

```typescript
// src/ocpp/handlers/bootNotification.handler.ts
import { stationService } from '@services/station.service';
import { logger } from '@config/logger';

interface BootNotificationPayload {
  chargePointModel: string;
  chargePointVendor: string;
  firmwareVersion?: string;
  chargePointSerialNumber?: string;
}

interface BootNotificationResponse {
  status: 'Accepted' | 'Pending' | 'Rejected';
  currentTime: string;
  interval: number; // heartbeat interval (seconds)
}

export async function bootNotificationHandler(
  stationId: string,
  payload: BootNotificationPayload
): Promise<BootNotificationResponse> {
  logger.info({ stationId, payload }, 'BootNotification received');

  await stationService.updateOnBoot(stationId, {
    modelName: payload.chargePointModel,
    vendorName: payload.chargePointVendor,
    firmwareVersion: payload.firmwareVersion,
    status: 'Online',
  });

  return {
    status: 'Accepted',
    currentTime: new Date().toISOString(),
    interval: 60, // 60초마다 Heartbeat
  };
}
```

### 4.7 CSMS → CP 명령 전송 (`src/ocpp/commands/remoteStartTransaction.command.ts`)

```typescript
import { v4 as uuidv4 } from 'uuid';
import { connectionManager } from '../connectionManager';
import { pendingRequests } from '../pendingRequests';
import { serializeCall } from '../messageParser';
import { ocppMessageService } from '@services/ocppMessage.service';
import { logger } from '@config/logger';

interface RemoteStartTransactionRequest {
  connectorId: number;
  idTag: string;
}

interface RemoteStartTransactionResponse {
  status: 'Accepted' | 'Rejected';
}

export async function sendRemoteStartTransaction(
  stationId: string,
  params: RemoteStartTransactionRequest
): Promise<RemoteStartTransactionResponse> {
  const ws = connectionManager.get(stationId);
  if (!ws || ws.readyState !== ws.OPEN) {
    throw new Error(`Station ${stationId} is not connected`);
  }

  const messageId = uuidv4();
  const message = serializeCall(messageId, 'RemoteStartTransaction', params);

  // 응답 대기 등록
  const responsePromise = pendingRequests.waitFor(messageId);

  // 메시지 전송
  ws.send(message);

  // OCPP 메시지 로깅 (CSMS → CP 방향)
  await ocppMessageService.log({
    stationId,
    messageId,
    direction: 2, // Call (CSMS→CP)
    action: 'RemoteStartTransaction',
    payload: message,
  });

  logger.info({ stationId, messageId, params }, 'RemoteStartTransaction sent');

  const response = await responsePromise;
  return response as RemoteStartTransactionResponse;
}
```

---

## 5. OCPP 1.6 지원 Action 목록

### Upstream (CP → CSMS)

| Action | 설명 | 핸들러 파일 |
|--------|------|-------------|
| BootNotification | 충전기 부팅/재시작 알림 | `bootNotification.handler.ts` |
| Heartbeat | 연결 유지 신호 | `heartbeat.handler.ts` |
| StatusNotification | 커넥터 상태 변경 알림 | `statusNotification.handler.ts` |
| StartTransaction | 트랜잭션 시작 | `startTransaction.handler.ts` |
| StopTransaction | 트랜잭션 종료 | `stopTransaction.handler.ts` |
| Authorize | IdTag 인증 요청 | `authorize.handler.ts` |
| MeterValues | 전력 계량 데이터 전송 | `meterValues.handler.ts` |
| DataTransfer | 벤더별 데이터 전송 | `dataTransfer.handler.ts` |

### Downstream (CSMS → CP)

| Action | 설명 | 명령 파일 |
|--------|------|-----------|
| RemoteStartTransaction | 원격 충전 시작 명령 | `remoteStartTransaction.command.ts` |
| RemoteStopTransaction | 원격 충전 종료 명령 | `remoteStopTransaction.command.ts` |
| Reset | 충전기 재시작 명령 | `reset.command.ts` |
| ChangeAvailability | 커넥터 가용성 변경 | `changeAvailability.command.ts` |

---

## 6. 에러 코드 (OCPP 1.6 CallError)

| ErrorCode | 사용 시점 |
|-----------|-----------|
| `NotImplemented` | 지원하지 않는 Action 수신 시 |
| `NotSupported` | 지원하지 않는 파라미터 조합 |
| `InternalError` | 서버 내부 처리 중 예외 발생 |
| `ProtocolError` | 메시지 구조 자체가 OCPP 비준수 |
| `SecurityError` | 인증/보안 위반 |
| `FormationViolation` | JSON Schema 검증 실패 |
| `PropertyConstraintViolation` | 값 범위/타입 위반 |
| `OccurenceConstraintViolation` | 필수 필드 누락 |
| `TypeConstraintViolation` | 타입 불일치 |
| `GenericError` | 기타 분류되지 않는 에러 |

---

## 7. 커넥터 상태 전이

```
              BootNotification
                    │
                    ▼
              ┌──────────┐
              │Available │ ◄─── ChangeAvailability(Operative)
              └────┬─────┘
                   │ StartTransaction / RemoteStart
                   ▼
              ┌──────────┐
              │Preparing │
              └────┬─────┘
                   │ (차량 연결, 충전 시작)
                   ▼
              ┌──────────┐
              │Charging  │
              └────┬─────┘
                   │ StopTransaction / RemoteStop
                   ▼
              ┌──────────┐
              │Finishing │
              └────┬─────┘
                   │
                   ▼
              ┌──────────┐
              │Available │
              └──────────┘

   Faulted ─ StatusNotification(Faulted) → 어느 상태에서든 전이 가능
```

---

## 8. 체크리스트

- [ ] WebSocket 서버 `/ocpp/:stationId` 경로 설정
- [ ] `ocpp1.6` subprotocol 협상 처리
- [ ] Basic Auth 검증 (Security Profile 1)
- [ ] 모든 Upstream Action 핸들러 구현
- [ ] Downstream 명령 전송 + 응답 대기(30초 타임아웃) 구현
- [ ] 중복 연결 처리 (기존 연결 종료 후 재등록)
- [ ] 모든 OCPP 메시지 DB 로깅
- [ ] CallError 응답으로 Graceful Failure 처리
- [ ] OCTT(Open Charge Testing Tool) 에지 케이스 대응 확인
