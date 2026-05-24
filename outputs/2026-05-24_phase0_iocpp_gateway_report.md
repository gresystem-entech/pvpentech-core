# Phase 0 — IOcppGateway 인터페이스 정의 보고서

**작성일**: 2026-05-24  
**작업 범위**: P0-T6 IOcppGateway 인터페이스 정의 및 Portal 코드 마이그레이션

---

## 1. 인터페이스 시그니처 정의

**파일**: `src/ocpp/gateway.interface.ts`

| 메소드 | 설명 |
|--------|------|
| `isStationConnected(stationId): boolean` | WebSocket OPEN 상태 확인 |
| `getConnectedStationIds(): string[]` | 연결된 모든 충전기 ID 반환 |
| `startSession(params): Promise<{status}>` | RemoteStartTransaction (OCPP 1.6 §5.11) |
| `stopSession(params): Promise<{status}>` | RemoteStopTransaction (OCPP 1.6 §5.12) |
| `resetStation(params): Promise<{status}>` | Reset — Hard/Soft (§5.10) |
| `changeAvailability(params): Promise<{status}>` | ChangeAvailability (§5.2) |
| `updateFirmware(params): Promise<{}>` | UpdateFirmware (§5.18) |
| `sendRawCall(params): {messageId} \| null` | Fire-and-forget CALL 송신 |
| `forceDisconnect(stationId): void` | WebSocket 강제 종료 + 등록 해제 |

반환 타입에 `messageId`를 포함하지 않은 이유: `sendCommand()` 헬퍼가 내부적으로 UUID를 생성하지만 호출자에게 반환하지 않는다. 기존 동작과 일치시켜 인터페이스를 정의함.

**Phase 2 교체 지점**: `src/ocpp/gateway.impl.ts` 파일의 `OcppGatewayImpl` 클래스를 `CoreApiGatewayImpl`(HTTP 클라이언트)로 교체. `gateway.interface.ts`와 모든 호출부는 변경 불필요.

---

## 2. 마이그레이션된 호출 위치 목록

| 파일 | 제거된 import | 변경된 호출 |
|------|-------------|------------|
| `src/services/charge.service.ts` | `@ocpp/commands/remoteStartTransaction`, `@ocpp/commands/remoteStopTransaction`, `@ocpp/connectionManager` | `startSession`, `stopSession`, `isStationConnected` |
| `src/services/payment.service.ts` | `@ocpp/commands/remoteStartTransaction`, `@ocpp/connectionManager` | `startSession`, `isStationConnected` |
| `src/services/station.service.ts` | `@ocpp/connectionManager` | `isStationConnected`, `getConnectedStationIds` |
| `src/services/stats.service.ts` | `@ocpp/connectionManager` | `getConnectedStationIds().length` (기존 `getConnectionCount()` 대체) |
| `src/services/firmwareCampaign.service.ts` | `@ocpp/commands` (index), `@ocpp/connectionManager` | `updateFirmware`, `isStationConnected` |
| `src/services/provision.service.ts` | `@ocpp/connectionManager` | `forceDisconnect` |
| `src/routes/index.ts` | `@ocpp/commands/remoteStart`, `@ocpp/commands/remoteStop`, `@ocpp/commands/reset`, `@ocpp/commands/changeAvailability`, `@ocpp/connectionManager`, `@ocpp/messageParser`, `uuid` | `startSession`, `stopSession`, `resetStation`, `changeAvailability`, `isStationConnected`, `sendRawCall` (×3) |
| `src/routes/portal/partner/stations.routes.ts` | `@ocpp/connectionManager` | `isStationConnected` |
| `src/routes/portal/cs/ops.routes.ts` | `@ocpp/connectionManager`, `@ocpp/messageParser`, `uuid` | `getConnectedStationIds`, `sendRawCall` (×2) |

---

## 3. 잔존 직접 import 검사 결과

### `@ocpp/commands` 직접 import
- **결과**: src/ 전체에서 0건 — services/, routes/, jobs/processors/ 영역에 없음
- OCPP 내부(`gateway.impl.ts`, `ocpp/commands/_sender.ts`, `ocpp/commands/*.command.ts`)에만 존재

### `connectionManager` 직접 참조
- **services/ 영역**: `provision.service.ts:55` — 주석 라인만 잔존 (import 없음, 코드 없음)
- **routes/ 영역**: 0건
- OCPP 내부(`ocpp/server.ts`, `ocpp/connectionManager.ts`, `ocpp/commands/_sender.ts`, `ocpp/commands/getDiagnostics.command.ts`, `ocpp/gateway.impl.ts`)에만 존재 — 정상

---

## 4. 컴파일 검증 결과

```
npx tsc --noEmit
```

- **src/ 영역 오류**: 0건
- **사전 존재 오류**: `scripts/` 폴더 3개 파일이 tsconfig `rootDir: src` 범위 밖에 있는 기존 문제 (본 작업과 무관)

---

## 5. Phase 2 교체 단일 지점

Phase 2에서 CSMS-Core / CSMS-Portal 분리 시 변경할 파일은 **단 하나**:

```
src/ocpp/gateway.impl.ts
```

`OcppGatewayImpl` 클래스를 `CoreApiGatewayImpl`로 교체하고, 내부 구현을 HTTP 호출로 전환한다.
싱글톤 export `ocppGateway`의 타입은 `IOcppGateway`이므로 모든 호출부(`charge.service.ts`, `payment.service.ts`, `routes/index.ts` 등)는 변경 불필요.
