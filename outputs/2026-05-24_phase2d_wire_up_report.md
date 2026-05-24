# Phase 2-D Wire-Up Report

**날짜**: 2026-05-24  
**작업자**: AI Agent (Phase 2-D)

---

## Before / After 결합점 표

| 결합점 | Before | After |
|--------|--------|-------|
| D1. charge.service.ts OCPP 호출 | `@pvpentech/core/ocpp/gateway.impl` (직접 import) | `../coreClient/coreApiGateway.impl` (HTTP 경유) |
| D1. payment.service.ts OCPP 호출 | `@pvpentech/core/ocpp/gateway.impl` (직접 import) | `../coreClient/coreApiGateway.impl` (HTTP 경유) |
| D1. stats.service.ts 연결 수 조회 | `@pvpentech/core/ocpp/gateway.impl` (직접 import) | `../coreClient/coreApiGateway.impl` (HTTP 경유) |
| D1. ops.routes.ts (CS Admin) | `@pvpentech/core/ocpp/gateway.impl` (직접 import) | `@portal/coreClient/coreApiGateway.impl` (HTTP 경유) |
| D1. partner/stations.routes.ts | `@pvpentech/core/ocpp/gateway.impl` (직접 import) | `@portal/coreClient/coreApiGateway.impl` (HTTP 경유) |
| D2. stopTransaction.handler | refundService + postChargeBillingQueue 직접 호출 | TransactionStopped Outbox 발행 → Portal Consumer 위임 |
| D3. startTransaction.handler | Outbox 없음 | TransactionStarted Outbox 발행 |
| D5. statusNotification.handler | Outbox 없음 | ConnectorStatusChanged + FaultRaised/FaultCleared Outbox 발행 |
| D6. bootNotification.handler | Outbox 없음 | StationOnline Outbox 발행 |
| D6. server.ts close 핸들러 | prisma.update만 | StationOffline Outbox 발행 + prisma.update (원자적) |
| D7. firmwareStatusNotification.handler | Outbox 없음 | FirmwareStatusChanged Outbox 발행 |
| D4. meterValues.handler | Outbox 없음 | MeterValueUpdate Outbox 발행 (기본 골격) |
| D8. _sender.ts (OCPP 명령 응답) | ocpp_command_result DB 갱신만 | OcppCommandResultReceived Outbox 발행 + DB 갱신 (원자적) |

---

## 각 OCPP 이벤트별 발행 위치

| 이벤트 | 발행 위치 | 발행 트리거 | 원자성 | 페이로드 핵심 필드 |
|--------|----------|------------|--------|------------------|
| `StationOnline` | `bootNotification.handler.ts` | BootNotification.req 수신 + Accepted | prisma.$transaction | stationId, vendor, model, firmwareVersion |
| `StationOffline` | `server.ts` ws.on('close') | WebSocket 연결 종료 | prisma.$transaction | stationId, reason |
| `TransactionStarted` | `startTransaction.handler.ts` | StartTransaction.req 수신 | prisma.$transaction | transactionId, sessionId, connectorId, meterStart, unitPriceVnd, settlement snapshot |
| `TransactionStopped` | `stopTransaction.handler.ts` | StopTransaction.req 수신 | prisma.$transaction | transactionId, sessionId, meterStop, totalKwh, costVnd, timeStart/End, reason |
| `MeterValueUpdate` | `meterValues.handler.ts` | MeterValues.req 수신 | 별도 prisma.$transaction | transactionId, sessionId, currentKwh, currentW |
| `ConnectorStatusChanged` | `statusNotification.handler.ts` | StatusNotification.req (connectorId > 0) | prisma.$transaction | stationId, connectorId, status, errorCode |
| `FaultRaised` | `statusNotification.handler.ts` | StatusNotification.req (errorCode ≠ NoError) | prisma.$transaction (동일 tx) | stationId, connectorId, errorCode, info |
| `FaultCleared` | `statusNotification.handler.ts` | StatusNotification.req (이전 fault → NoError 복귀) | prisma.$transaction (동일 tx) | stationId, connectorId |
| `FirmwareStatusChanged` | `firmwareStatusNotification.handler.ts` | FirmwareStatusNotification.req 수신 | prisma.$transaction | stationId, status |
| `OcppCommandResultReceived` | `commands/_sender.ts` | CSMS→CP 명령 응답 수신 (성공/오류/timeout) | prisma.$transaction | stationId, messageId, action, status, responsePayload |

---

## 신규 파일

| 파일 | 역할 |
|------|------|
| `packages/portal/src/coreClient/coreApiGateway.impl.ts` | CoreApiGatewayImpl — IOcppGateway의 HTTP 구현체. Portal이 Core Internal API를 통해 OCPP 명령 실행 |

---

## 수정 파일

| 파일 | 변경 내용 |
|------|---------|
| `packages/portal/src/services/charge.service.ts` | `@pvpentech/core/ocpp/gateway.impl` → `coreApiGateway`, isStationConnected async cast 2곳 |
| `packages/portal/src/services/payment.service.ts` | 동일 gateway 교체, isStationConnected async cast |
| `packages/portal/src/services/stats.service.ts` | gateway import 교체 (getConnectedStationIds → [] 반환 허용, TODO Phase 4) |
| `packages/portal/src/routes/portal/cs/ops.routes.ts` | gateway import 교체 |
| `packages/portal/src/routes/portal/partner/stations.routes.ts` | gateway import 교체, isStationConnected Promise.all 처리 |
| `packages/core/src/ocpp/handlers/stopTransaction.handler.ts` | refund/billing 직접 호출 제거, TransactionStopped Outbox 발행 |
| `packages/core/src/ocpp/handlers/startTransaction.handler.ts` | TransactionStarted Outbox 발행 추가 |
| `packages/core/src/ocpp/handlers/bootNotification.handler.ts` | StationOnline Outbox 발행 추가 |
| `packages/core/src/ocpp/handlers/statusNotification.handler.ts` | ConnectorStatusChanged/FaultRaised/FaultCleared Outbox 발행 추가 |
| `packages/core/src/ocpp/handlers/firmwareStatusNotification.handler.ts` | FirmwareStatusChanged Outbox 발행 추가 |
| `packages/core/src/ocpp/handlers/meterValues.handler.ts` | MeterValueUpdate Outbox 발행 기본 골격 추가 |
| `packages/core/src/ocpp/server.ts` | ws.on('close') → StationOffline Outbox 발행 추가 |
| `packages/core/src/ocpp/commands/_sender.ts` | OcppCommandResultReceived Outbox 발행 추가 (성공/오류/timeout 모두) |

---

## 잔존 결합점 검증 결과

### refundService.createFromTransaction
- `packages/core/src/ocpp/handlers/stopTransaction.handler.ts` — 주석에만 언급 (제거 사실 설명) — **OK**
- `packages/portal/src/eventConsumer/handlers/transactionStopped.handler.ts` — Portal Consumer에서만 호출 — **OK (설계 의도)**

### postChargeBillingQueue
- `packages/core/src/jobs/queues.ts` — 큐 정의만 (Core 내부 잡용) — **OK**
- `packages/portal/src/eventConsumer/handlers/transactionStopped.handler.ts` — Portal Consumer에서만 호출 — **OK (설계 의도)**
- `packages/core/src/ocpp/handlers/stopTransaction.handler.ts` — 주석에만 언급 — **OK**

### ocppGateway (Portal 측 직접 import)
- `packages/core/src/ocpp/gateway.impl.ts` — 싱글톤 정의 (Core 내부) — **OK**
- `packages/core/src/internal-api/routes/firmware.routes.ts` — Core 내부 API 라우트 — **OK (D11: Core 내부 직접 호출 유지)**
- `packages/core/src/services/provision.service.ts` — Core 서비스 — **OK**
- `packages/core/src/services/firmwareCampaign.service.ts` — Core 서비스 — **OK**
- `packages/core/src/services/station.service.ts` — Core 서비스 — **OK**
- `packages/portal/src/services/charge.service.ts` — `coreApiGateway as ocppGateway` 별칭 사용 — **OK (교체 완료)**
- `packages/portal/src/services/payment.service.ts` — `coreApiGateway as ocppGateway` 별칭 사용 — **OK (교체 완료)**
- `packages/portal/src/services/stats.service.ts` — `coreApiGateway as ocppGateway` 별칭 사용 — **OK (교체 완료)**
- `packages/portal/src/routes/portal/cs/ops.routes.ts` — `coreApiGateway as ocppGateway` — **OK (교체 완료)**
- `packages/portal/src/routes/portal/partner/stations.routes.ts` — `coreApiGateway as ocppGateway` — **OK (교체 완료)**

---

## apps/server/src/index.ts 확인

```
startOutboxRelay()          ✅  line 48
registerEventHandlers()     ✅  line 51
await startConsumer()       ✅  line 52
```

---

## 컴파일 검증

```
$ npm run build
> tsc -p tsconfig.build.json
(출력 없음 — 빌드 성공)
```

---

## 알려진 한계 / TODO

| 항목 | 설명 | 우선순위 |
|------|------|---------|
| MeterValue throttle 미구현 | 현재 모든 MeterValues 메시지마다 Outbox 발행 → DB 부하 증가 가능. 1분 간격 또는 의미있는 kWh 변화 시만 발행 필요 | Phase 4 |
| IOcppGateway.isStationConnected 동기 시그니처 불일치 | 인터페이스는 `boolean`(동기), CoreApiGatewayImpl은 실제로 `Promise<boolean>` 반환. `as unknown as Promise<boolean>` 캐스팅으로 임시 처리. Phase 4에서 인터페이스를 `Promise<boolean>`으로 정식 변경 필요 | Phase 4 |
| IOcppGateway.stopSession — transactionId vs sessionId 불일치 | 인터페이스는 `transactionId: number` 기반, CoreApiClient는 `sessionId: string` 기반. chargeService.stopCharge는 sessionId를 보유하므로 gateway 우회하여 직접 coreApiClient 호출 가능 → Phase 4 인터페이스 정정 | Phase 4 |
| getConnectedStationIds 미지원 | CoreApiGateway는 빈 배열 반환. stats.service의 `connected` 카운트가 항상 0. /api/internal/v1/stations?connected=true 엔드포인트 추가 후 구현 필요 | Phase 4 |
| sendRawCall 미지원 | CoreApiGateway는 null 반환. ops.routes.ts의 broadcastOcppCommand가 항상 STATION_OFFLINE 반환. Internal API에 raw-call 엔드포인트 추가 필요 | Phase 4 |
| forceDisconnect 미지원 | CoreApiGateway는 no-op. provision.service의 forceDisconnect가 무효. Internal API에 disconnect 엔드포인트 추가 필요 | Phase 4 |
| FaultCleared 감지 — 이전 상태 조회 비용 | statusNotification마다 prevConnector 조회 1회 추가 (SELECT). 고주기 환경에서는 in-memory 캐시 검토 필요 | Phase 4 |
