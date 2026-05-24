# Phase 2-C 완료 보고서 — Portal CoreApiClient + Redis Stream Consumer 핸들러

**작성일**: 2026-05-24
**작업 범위**: `packages/portal/src/core-client/`, `packages/portal/src/eventConsumer/handlers/`

---

## 1. CoreApiClient 메소드 표 (Core 라우트 매핑)

### 1-1. 충전 세션 (동기, 35s timeout)

| CoreApiClient 메소드 | Core 라우트 | OCPP Action |
|---------------------|------------|-------------|
| `startSession(params)` | POST `/sessions/start` | RemoteStartTransaction |
| `stopSession(params)` | POST `/sessions/:sessionId/stop` | RemoteStopTransaction |

### 1-2. 충전기 상태 조회 (비동기, 10s timeout)

| CoreApiClient 메소드 | Core 라우트 |
|---------------------|------------|
| `getStation(stationId)` | GET `/stations/:stationId` |
| `listStations(query?)` | GET `/stations` |
| `getStationConnection(stationId)` | GET `/stations/:stationId/connection` |
| `listConnectors(stationId)` | GET `/stations/:stationId/connectors` |
| `listOcppMessages(stationId, query?)` | GET `/stations/:stationId/ocpp-messages` |
| `listCommandResults(stationId, query?)` | GET `/stations/:stationId/command-results` |

### 1-3. 원격 제어 명령 (비동기, 202)

| CoreApiClient 메소드 | Core 라우트 | OCPP Action |
|---------------------|------------|-------------|
| `sendReset(stationId, type)` | POST `…/commands/reset` | Reset |
| `sendChangeAvailability(stationId, params)` | POST `…/commands/change-availability` | ChangeAvailability |
| `sendChangeConfiguration(stationId, params)` | POST `…/commands/change-configuration` | ChangeConfiguration |
| `sendGetConfiguration(stationId, params?)` | POST `…/commands/get-configuration` | GetConfiguration |
| `sendClearCache(stationId)` | POST `…/commands/clear-cache` | ClearCache |
| `sendUnlockConnector(stationId, params)` | POST `…/commands/unlock-connector` | UnlockConnector |
| `sendTriggerMessage(stationId, params)` | POST `…/commands/trigger-message` | TriggerMessage |
| `sendDataTransfer(stationId, params)` | POST `…/commands/data-transfer` | DataTransfer |

### 1-4. 펌웨어

| CoreApiClient 메소드 | Core 라우트 |
|---------------------|------------|
| `listFirmware(query?)` | GET `/firmware` |
| `createFirmwareCampaign(params)` | POST `/firmware/campaigns` |
| `getFirmwareCampaign(id)` | GET `/firmware/campaigns/:id` |
| `cancelFirmwareCampaign(id)` | DELETE `/firmware/campaigns/:id` |
| `updateStationFirmware(stationId, params)` | POST `/stations/:stationId/firmware/update` |

### 1-5. 진단 및 설정

| CoreApiClient 메소드 | Core 라우트 |
|---------------------|------------|
| `requestStationDiagnostics(stationId, params)` | POST `/stations/:stationId/diagnostics` |
| `listStationDiagnostics(stationId, query?)` | GET `/stations/:stationId/diagnostics` |
| `getStationConfig(stationId, query?)` | GET `/stations/:stationId/config` |
| `putStationConfig(stationId, key, params)` | PUT `/stations/:stationId/config/:key` |

### 1-6. 프로비저닝 + 제조사

| CoreApiClient 메소드 | Core 라우트 |
|---------------------|------------|
| `listProvisioning(query?)` | GET `/provisioning` |
| `createProvisioning(params)` | POST `/provisioning` |
| `rejectProvisioning(id, reason?)` | PUT `/provisioning/:id/reject` |
| `listManufacturers(query?)` | GET `/manufacturers` |
| `createManufacturer(params)` | POST `/manufacturers` |

---

## 2. 에러 처리 아키텍처

```
axios error
  → isRetryable() 판별
    - 응답 없음(네트워크) OR 5xx → 재시도 (최대 2회, 200ms / 800ms 백오프)
    - 4xx → 즉시 throw
  → toCoreApiError() 변환
    - code: response.body.error.code OR 'NETWORK_ERROR'
    - httpStatus: response.status OR 0
  → CoreApiError throw
```

- POST 명령은 `Idempotency-Key`를 자동 생성(uuidv4)하여 첨부. 재시도 시 동일 키 사용 → 멱등 안전.
- 동기 명령(sessions): 35s timeout axios 인스턴스 사용.
- 비동기 명령(commands, GET): 10s timeout 별도 인스턴스.

---

## 3. 이벤트 핸들러 동작 요약

| 핸들러 | 이벤트 타입 | Phase 2-C 동작 | 실질 동작 시점 |
|--------|------------|---------------|--------------|
| `handleTransactionStarted` | TransactionStarted | idempotency + 로그 | Phase 2-D (Core Outbox wired) |
| `handleTransactionStopped` | TransactionStopped | refund 생성 + billing 큐잉 | Phase 2-D (Core Outbox wired) |
| `handleMeterValueUpdate` | MeterValueUpdate | 로그만 (debug) | Phase 2-D |
| `handleStationOnline` | StationOnline | 로그만 | Phase 2-D |
| `handleStationOffline` | StationOffline | 로그만 | Phase 2-D |
| `handleConnectorStatusChanged` | ConnectorStatusChanged | 로그만 | Phase 2-D |
| `handleFaultRaised` | FaultRaised | 로그만 (warn) | Phase 2-D |
| `handleFaultCleared` | FaultCleared | 로그만 | Phase 2-D |
| `handleFirmwareStatusChanged` | FirmwareStatusChanged | 로그만 | Phase 2-D |
| `handleOcppCommandResultReceived` | OcppCommandResultReceived | 로그만 | Phase 2-D |

모든 핸들러 공통:
- `alreadyConsumed(eventId)` → 중복 이벤트 skip
- 성공 시 `markConsumed(eventId, eventType)` 기록
- 핸들러 throw → ack 안 됨 → PEL에 남아 재처리 (at-least-once 보장)

---

## 4. 미구현/TODO 항목

### Phase 2-C에서 의도적으로 구현하지 않은 항목

| 항목 | 이유 | 예정 단계 |
|------|------|---------|
| `POST /firmware/upload` (multipart) | FormData + multer 처리 별도 필요, 낮은 우선순위 | Phase 2-D 또는 별도 PR |
| `charge_session_projection` 투영 갱신 | 테이블 미존재, 서비스 경계 분리 예정 | Phase 3 |
| `charge_station_projection` / `charge_connector_projection` | 동일한 이유 | Phase 3 |
| FaultRaised/Cleared 알림 발송 | 알림 발송 서비스(push/SMS) 미구현 | Phase 3 |
| FirmwareStatusChanged 캠페인 투영 갱신 | 투영 테이블 미존재 | Phase 3 |
| OcppCommandResultReceived action별 처리 | 투영 및 캐시 계층 미존재 | Phase 3 |
| TransactionStopped 부분 실패(sub-saga) | 복잡도, Phase 3 이후 설계 | Phase 3 |

---

## 5. Phase 2-D 결합점 (Wire-up 대상)

Phase 2-D에서 Core의 `stopTransaction.handler.ts`가 Outbox 이벤트 발행으로 전환되면 다음이 자동으로 연결됩니다.

1. **TransactionStopped wired** → `handleTransactionStopped` 실제 실행
   - `refundService.createFromTransaction(transactionId)` 호출
   - `postChargeBillingQueue.add('billing', { transactionId })` 큐잉

2. **charge.service.ts CoreApiClient 치환** → `startSession()` / `stopSession()` 실제 사용
   - 현재 charge.service.ts는 IOcppGateway 직접 호출 중

3. **모든 이벤트 핸들러 실질 동작** → Phase 2-D 이후 검증 필요

---

## 6. 생성/수정 파일 목록

### 신규 생성
- `packages/portal/src/core-client/errors.ts` — CoreApiError 클래스
- `packages/portal/src/core-client/coreApiClient.ts` — axios 기반 HTTP 클라이언트 (30개 메소드)
- `packages/portal/src/core-client/index.ts` — 모듈 공개 API
- `packages/portal/src/eventConsumer/handlers/transactionStarted.handler.ts`
- `packages/portal/src/eventConsumer/handlers/transactionStopped.handler.ts`
- `packages/portal/src/eventConsumer/handlers/meterValueUpdate.handler.ts`
- `packages/portal/src/eventConsumer/handlers/stationOnline.handler.ts`
- `packages/portal/src/eventConsumer/handlers/stationOffline.handler.ts`
- `packages/portal/src/eventConsumer/handlers/connectorStatusChanged.handler.ts`
- `packages/portal/src/eventConsumer/handlers/faultRaised.handler.ts`
- `packages/portal/src/eventConsumer/handlers/faultCleared.handler.ts`
- `packages/portal/src/eventConsumer/handlers/firmwareStatusChanged.handler.ts`
- `packages/portal/src/eventConsumer/handlers/ocppCommandResultReceived.handler.ts`
- `packages/portal/src/eventConsumer/handlers/index.ts` — registerEventHandlers()

### 수정
- `apps/server/src/index.ts` — registerEventHandlers() 호출 추가 (startConsumer 직전)
- `packages/portal/src/index.ts` — core-client, handlers export 추가

### 검증
- `npx tsc --noEmit` — 컴파일 오류 0건
