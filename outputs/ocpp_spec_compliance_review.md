# OCPP 신규 스펙 준수 검토 보고서

> 기준 문서: `documents/design_guide/new_csms_specification.md` (EVNEST 결함 기반 신규 요구사항)
> 평가 대상: Pvpentech CSMS 현행 구현 (`src/ocpp/`, `prisma/schema.prisma`)
> 작성일: 2026-05-08

---

## 1. 결론 요약

### 14개 REQ 충족 현황

| 구분 | 개수 | REQ 목록 |
|---|---|---|
| 충족 ✅ | 4 | REQ-PROTO-001, REQ-PROTO-002, REQ-PROTO-003, REQ-TIME-001 |
| 부분 충족 ⚠️ | 6 | REQ-TX-001, REQ-TX-003, REQ-METER-001, REQ-STATUS-001, REQ-BOOT-001, REQ-SEC-002 |
| 미충족 ❌ | 4 | REQ-CONF-001, REQ-DT-001, REQ-FW-001~003, REQ-DIAG-001~002 |
| 해당 없음 / 우선 제외 권장 | 4 | REQ-TENANT-001, REQ-TARIFF-001~002, REQ-APP-001~002, REQ-SEC-003 (별도 섹션 참조) |

### CP→CSMS 메시지 처리 통계 (10개)

| 메시지 | 현행 | EVNEST 대비 개선 여부 |
|---|---|---|
| BootNotification | ⚠️ | Pending 미지원이나 하드코딩 transactionId 문제는 없음 |
| Heartbeat | ✅ | last_heartbeat_at 갱신 정상 구현 |
| Authorize | ⚠️ | expiryDate 응답 누락 |
| StartTransaction | ⚠️ | connectorId 읽음, transactionId 하드코딩 없음(DB id 사용) |
| StopTransaction | ⚠️ | transactionId로 매칭하나 transactionData 미처리 |
| MeterValues | ⚠️ | 다측정값 저장하나 context/format/location 누락 |
| StatusNotification | ⚠️ | 9개 상태 모두 처리, errorCode 저장 미흡 |
| DataTransfer | ⚠️ | 핸들러 레지스트리 미구현 |
| FirmwareStatusNotification | ❌ | 핸들러 자체 없음 |
| DiagnosticsStatusNotification | ❌ | 핸들러 자체 없음 |

### CSMS→CP 명령 빌더 통계 (19개 중)

- 빌더 존재: 4개 (RemoteStart, RemoteStop, Reset, ChangeAvailability)
- 빌더 없음: 15개 (GetConfiguration, ChangeConfiguration, GetDiagnostics, UpdateFirmware, TriggerMessage, ReserveNow, CancelReservation, SendLocalList, GetLocalListVersion, ClearCache, UnlockConnector, SetChargingProfile, ClearChargingProfile, GetCompositeSchedule, DataTransfer→CP)

### 가장 시급한 갭 Top 5 (운영 영향 큰 순)

1. **FirmwareStatusNotification / DiagnosticsStatusNotification 핸들러 없음** — 충전기가 보내는 펌웨어/진단 상태를 CSMS가 완전히 묵살. 운영자가 펌웨어 업데이트 성공 여부를 알 수 없음.
2. **CSMS→CP 명령 빌더 15개 미구현** — GetConfiguration 없어 충전기 설정 조회 불가, UpdateFirmware 없어 펌웨어 원격 배포 불가 등 핵심 운영 명령 누락.
3. **명령 응답 결과(OcppCommandResult) 영속화 없음** — 현행 pendingRequests는 인메모리 Promise이므로 서버 재시작 시 모든 미응답 명령 유실, GetConfiguration 결과를 UI에서 조회할 수 없음.
4. **StopTransaction transactionData 미처리** — 일부 충전기가 종료 시 누적 측정값을 transactionData에 담아 보내는데 현행 코드가 무시하여 마지막 충전량 데이터 유실 가능.
5. **MeterValues의 context/format/location 미저장** — Transaction.Begin/End context가 저장 안 돼 정확한 충전 시작·종료 에너지 값 추적 불가.

---

## 2. REQ별 점검

### REQ-PROTO-001 — CALLERROR 송수신 구현

**Pvpentech 현황: ✅ 충족**

- `messageParser.ts:33~38`: MessageTypeId=4 파싱 완전 구현. `errorCode`, `errorDescription`, `errorDetails` 모두 추출.
- `messageRouter.ts:57~59`: `pendingRequests.reject(messageId, error)` 호출로 CALLERROR 수신 처리.
- `messageRouter.ts:40`, `47`: 스키마 실패 시 `serializeCallError('FormationViolation', ...)`, 미구현 액션 시 `serializeCallError('NotImplemented', ...)` 회신.
- `OcppMessage` 모델의 `direction` 컬럼(Int: 2/3/4)으로 메시지 타입 저장.

**갭**: OcppMessage 로깅 시 direction=4(CallError)인 경우에도 `payload`에 raw 문자열로만 저장되므로, errorCode를 별도 컬럼으로 인덱싱하지 않아 특정 에러 유형 조회가 어렵다. Minor 수준.

---

### REQ-PROTO-002 — UniqueId 기반 요청-응답 매칭

**Pvpentech 현황: ✅ 충족 (단, 영속성 한계 있음)**

- `pendingRequests.ts` 전체: `Map<messageId, {resolve, reject, timer}>` 구조. UUID 기반 messageId 발급(`remoteStartTransaction.command.ts:8`의 `uuidv4()`).
- 타임아웃: `env.OCPP_RESPONSE_TIMEOUT_MS`(환경변수)로 설정, 만료 시 reject 처리.
- EVNEST의 `connection_id` 단일칸 덮어쓰기 문제는 없음 — 각 요청이 독립 Promise.

**갭**: 인메모리 Map이므로 서버 재시작 시 pending 명령이 유실. 스펙 §1.2의 `PendingRequest` 테이블 영속화는 미구현. 작업량 M. 운영 환경에서 재시작이 드물면 Minor, PM2 reload가 잦으면 Major.

**권장 구현**: `prisma/schema.prisma`에 `PendingRequest` 모델 추가, `pendingRequests.ts`의 `waitFor` 호출 시 DB에 INSERT, resolve/reject 시 UPDATE(status=completed/error). 단 타임아웃 워커(cron job) 별도 구현 필요.

---

### REQ-PROTO-003 — 미구현 액션 시 CALLERROR(NotImplemented) 회신

**Pvpentech 현황: ✅ 충족**

- `messageRouter.ts:44~48`: `handlerMap.get(action)` 미존재 시 `serializeCallError(messageId, 'NotImplemented', ...)` 회신. EVNEST의 `else: pass` 침묵 패턴 없음.

---

### REQ-TX-001 — transactionId 전역 고유값 발급

**Pvpentech 현황: ⚠️ 부분 충족**

- `startTransactionHandler`: `transaction.id`(PostgreSQL autoincrement PK)를 transactionId로 반환. EVNEST의 항상-1 하드코딩 없음.
- `startTransaction.handler.ts:42`, `89`: `transactionId: newTx.id` 또는 `transactionId: transaction.id` 반환.

**갭**: `ocppTransactionId` 필드(`schema.prisma:241`)가 `transaction.id`와 동일값으로 설정(`startTransaction.handler.ts:58`: `ocppTransactionId: transaction.id`)되어 이중 컬럼이 생긴다. 충전기가 `StopTransaction`에서 보내는 `transactionId`(OCPP)를 `ocppTransactionId`로 매칭하는 구조는 맞으나(`stopTransactionHandler:23`), RFID 직접 시작 케이스의 `ocppTransactionId` 설정이 누락되어 있다(`startTransaction.handler.ts:42`: newTx 생성 시 ocppTransactionId 미설정). 작업량 S.

**권장 구현**: `startTransaction.handler.ts:31~44`의 newTx 생성 블록에 `ocppTransactionId: newTx.id` 추가. `prisma/schema.prisma` 마이그레이션 불필요(컬럼 이미 존재).

---

### REQ-TX-002 — connectorId 동적 결정 (하드코딩 금지)

**Pvpentech 현황: ✅ 충족**

- `remoteStartTransaction.command.ts:7~11`: `connectorId: number` 파라미터로 동적 수신.
- `changeAvailability.command.ts:7~10`: `connectorId: number` 파라미터.
- EVNEST의 `connectorId: 1` 하드코딩 없음.

---

### REQ-TX-003 — 트랜잭션 상태 머신 명시

**Pvpentech 현황: ⚠️ 부분 충족**

- `TransactionStatus` enum (`schema.prisma:281~286`): Pending, Active, Stopped, Failed 4개 상태.
- 스펙 요구 상태: Authorized → Started → InProgress → Stopping → Stopped / Aborted.

**갭**: `Authorized` 상태(Authorize 후 StartTransaction 전) 미존재. `Stopping` 상태(RemoteStop 발송 후 StopTransaction 수신 전) 미존재. 운영상 일시적 상태이므로 Minor이나, 정확한 흐름 추적을 위해 추가 권장. 작업량 S(enum 확장 + 마이그레이션).

**권장 구현**: `schema.prisma`의 `TransactionStatus`에 `Authorized`, `Stopping` 추가, `prisma migrate` 실행. 해당 상태 전이를 `authorizeHandler`와 charge stop API에서 업데이트.

---

### REQ-METER-001 — MeterValues 모든 measurand 영속화

**Pvpentech 현황: ⚠️ 부분 충족**

- `meterValues.handler.ts:48~58`: 모든 sampledValue를 루프하여 `MeterValue` 테이블에 INSERT. measurand, value, unit, phase 저장.
- EVNEST처럼 Energy.Active.Import.Register만 추출하는 문제는 없음.

**갭**:
1. `meterValues.handler.ts:53`: `measurand: sv.measurand || 'Energy.Active.Import.Register'` — measurand 미전송 시 Energy 값으로 기본값 설정하는 것은 적절하나, 다른 measurand를 Energy로 잘못 분류할 위험.
2. `MeterValue` 모델(`schema.prisma:296~309`)에 `context`, `format`, `location` 컬럼 없음. Transaction.Begin/End context 저장 불가.
3. `meterValues.handler.ts:32~39`: transactionId를 OCPP payload의 `p.transactionId`로 매칭하지 않고 `stationId + connectorId + Active` 쿼리로 찾음 — 동시 2충전 시 잘못된 트랜잭션에 데이터 기록 가능. 작업량 M.

**권장 구현**:
- `schema.prisma`의 `MeterValue`에 `context String?`, `format String?`, `location String?` 컬럼 추가 후 `prisma migrate`.
- `meterValues.handler.ts:32~39`의 트랜잭션 조회를 `ocppTransactionId: p.transactionId`로 우선 시도, fallback으로 현행 쿼리 유지.
- `meterValues.handler.ts:54~57`의 record에 `context: sv.context || null`, `format: sv.format || null`, `location: sv.location || null` 추가.

---

### REQ-METER-002 — MeterValues conf 응답 형식

**Pvpentech 현황: ✅ 충족**

- `meterValues.handler.ts:65`: `return {}` — 표준 빈 객체 응답.

---

### REQ-STATUS-001 — connectorId별 상태 독립 관리

**Pvpentech 현황: ✅ 충족**

- `statusNotificationHandler:56~97`: connectorId=0 처리(station-level)와 connectorId>=1 처리(connector-level) 분기.
- `Connector` 모델에 `currentStatus: ConnectorStatus` 저장, upsert로 최신 상태 유지.
- `ConnectorStatus` enum 9개 상태 전부 정의(`schema.prisma:65~75`).

**갭**: `StatusNotification` 수신 시 `timestamp`, `info`, `vendorId`, `vendorErrorCode` 필드를 Connector 테이블에 저장하지 않는다. 특히 `vendorErrorCode`는 현장 진단에 유용. 작업량 S.

---

### REQ-STATUS-002 — 에러 코드별 알림 정책

**Pvpentech 현황: ⚠️ 부분 충족**

- `statusNotificationHandler:100~108`: `ocppStatus === 'Faulted'` 시 `faultLog` 생성. errorCode 분기 없이 단일 FaultType.CommunicationError로 기록.
- EVNEST의 OverCurrentFailure만 분기 → 나머지 묵살 문제보다는 낫지만, 16개 errorCode별 정책은 없음.

**갭**: errorCode(ConnectorLockFailure, HighTemperature 등)를 `FaultLog.faultType`에 매핑하거나 별도 컬럼에 저장하지 않음. 알림 채널 및 자동조치 정책 없음. 작업량 M.

**권장 구현**: `FaultLog` 모델에 `errorCode String?` 컬럼 추가, `statusNotificationHandler`에서 `p.errorCode` 저장. 알림 정책은 `CsmsVariable` 테이블에 키-값으로 설정 가능.

---

### REQ-CONF-001 — 명령 응답 페이로드 영속화

**Pvpentech 현황: ❌ 미충족**

- `OcppCommandResult` 테이블 없음(schema.prisma 전체 미존재).
- 명령 빌더 4개가 `pendingRequests.waitFor()`로 응답을 받지만, 결과를 DB에 저장하지 않음.
- 예: `reset.command.ts:32`: `const response = await responsePromise; return response` — 응답이 호출자에게만 전달, 영속화 없음.

**갭**: GetConfiguration, GetCompositeSchedule 등의 응답 payload를 운영자가 나중에 조회할 수 없음. 타임아웃 발생 시 TimedOut 기록 없음. 작업량 M.

**권장 구현**:
- `schema.prisma`에 `OcppCommandResult` 모델 추가:
  ```
  model OcppCommandResult {
    id         Int      @id @default(autoincrement())
    messageId  String   @unique @db.VarChar(100)
    stationId  String   @db.VarChar(50)
    action     String   @db.VarChar(50)
    status     String   @db.VarChar(20)  // completed/timedOut/error
    payload    String?  @db.Text
    receivedAt DateTime @default(now())
    @@map("ocpp_command_result")
  }
  ```
- 명령 빌더 공통 wrapper 함수에서 응답 수신 후 INSERT.

---

### REQ-TENANT-001 — 멀티테넌시 (권장하지 않는 항목)

**Pvpentech 현황: 해당 없음 / 적용 제외 권장**

Pvpentech는 `PartnerProfile → ChargingSite → ChargingStation` 3계층 구조로 멀티테넌시를 이미 구현. 스펙의 `Company` 엔티티는 Pvpentech의 `PartnerProfile`에 해당. 별도 섹션 §6 참조.

---

### REQ-BOOT-001 — Rejected 응답 interval 준수

**Pvpentech 현황: ⚠️ 부분 충족**

- `bootNotificationHandler:63~68`: 미등록 충전기도 `Accepted` 반환(auto-create 정책). `Rejected` 응답 코드 경로 없음.
- EVNEST 문제(Rejected/Accepted 동일 interval)는 구조적으로 회피되어 있으나, `Pending` 상태 미지원.

**갭**: 미등록 충전기를 auto-create하는 현행 정책이 보안상 적합한지 재검토 필요. 사전 프로비저닝된 충전기만 Accepted로 처리하고 미등록 시 Rejected를 반환하는 설계가 스펙에 더 부합. 단 이는 운영 정책 결정 사항. 작업량 S.

---

### REQ-BOOT-002 — 펌웨어 버전 저장

**Pvpentech 현황: ✅ 충족**

- `bootNotificationHandler:36`, `43`: `firmwareVersion: p.firmwareVersion` DB 저장. try/except 없이 null-safe로 처리.

---

### REQ-TARIFF-001~002 — 요금제 테이블 분리 (권장하지 않는 항목)

**Pvpentech 현황: 부분 구현, 추가 작업 권장하지 않음**

- `ChargingSite.unitPrice`로 단가 관리 중. `SitePriceHistory`로 단가 이력 분리.
- cpnumber prefix 하드코딩 없음 — EVNEST 결함이 Pvpentech에는 없음.
- 별도 섹션 §6 참조.

---

### REQ-FW-001~003 — 펌웨어 업데이트

**Pvpentech 현황: ❌ 미충족**

- `UpdateFirmware` 명령 빌더 없음.
- `FirmwareStatusNotification` 핸들러 없음(`handlerMap`에 미등록: `handlers/index.ts` 전체 확인).
- `Firmware`, `FirmwareCampaign`, `FirmwareCampaignProgress` 테이블 없음.

**갭**: 원격 펌웨어 업데이트 기능 전체 미구현. 운영자가 충전기 펌웨어를 원격으로 배포할 수 없음. 작업량 L.

**권장 구현**:
1. `src/ocpp/commands/updateFirmware.command.ts` 신규 작성 (location은 `env.FIRMWARE_BASE_URL + filename`).
2. `src/ocpp/handlers/firmwareStatusNotification.handler.ts` 신규 작성, `handlers/index.ts`에 등록.
3. `schema.prisma`에 `Firmware`, `FirmwareCampaign`, `FirmwareCampaignProgress` 3개 모델 추가, `prisma migrate`.
4. 관리자 API 엔드포인트 `/admin/firmware` (업로드, 캠페인 생성, 진행 조회).

---

### REQ-DIAG-001~002 — 진단/원격 로그

**Pvpentech 현황: ❌ 미충족**

- `GetDiagnostics` 명령 빌더 없음.
- `DiagnosticsStatusNotification` 핸들러 없음.
- `DiagnosticsRequest` 테이블 없음.

**갭**: 충전기 로그 원격 수거 기능 전체 미구현. 작업량 M.

**권장 구현**:
1. `src/ocpp/commands/getDiagnostics.command.ts` 신규 작성 (location은 `env.DIAGNOSTICS_UPLOAD_URL`).
2. `src/ocpp/handlers/diagnosticsStatusNotification.handler.ts` 신규 작성.
3. `schema.prisma`에 `DiagnosticsRequest` 모델 추가.

---

### REQ-DT-001~002 — DataTransfer 핸들러 레지스트리

**Pvpentech 현황: ❌ 미충족 (기본 수용만 구현)**

- `dataTransfer.handler.ts:14~17`: `vendorId`, `messageId`를 읽지만 처리 로직 없이 `{ status: 'Accepted' }` 반환.
- 핸들러 레지스트리, UnknownVendorId/UnknownMessageId 응답, RelayService 없음.

**갭**: EVNEST의 if-elif 체인보다 단순화되었으나, 제대로 된 확장 구조가 없음. 작업량 M.

**권장 구현**: `src/ocpp/dataTransfer/registry.ts`에 `Map<string, Map<string, Handler>>` 구조 작성. 등록 없는 조합은 `UnknownVendorId` 또는 `UnknownMessageId` 반환.

---

### REQ-TIME-001~002 — UTC ISO 8601 준수

**Pvpentech 현황: ✅ 충족**

- `bootNotificationHandler:65`: `new Date().toISOString()` — Z 접미사 포함 UTC.
- `heartbeatHandler:17`: 동일.
- KST 수동 보정(`-timedelta(hours=9)`) 없음.

---

### REQ-APP-001~002 — 앱 세션 동시성 / 멱등성 (권장하지 않는 항목)

`AppSession` 모델이 현행 스키마에 별도로 없고 `Transaction` 모델이 sessionId로 동일 역할. 별도 섹션 §6 참조.

---

### REQ-SEC-001 — WSS(TLS) 강제

**Pvpentech 현황: ✅ 충족 (인프라 레벨)**

`server.ts`는 HTTP 서버를 받아 WebSocketServer를 생성. AWS ALB/Nginx 레이어에서 TLS 종료하는 표준 구성.

---

### REQ-SEC-002 — 충전기 인증

**Pvpentech 현황: ⚠️ 부분 충족**

- `server.ts:39~59`: `verifyClient`에서 `verifyOcppBasicAuth(stationId, authHeader)` 호출 — HTTP Basic Auth(Profile 1) 구현.
- TLS 클라이언트 인증서(Profile 3) 미지원.

---

### REQ-SEC-003 — 비밀정보 환경변수 분리

**Pvpentech 현황: ✅ 충족**

환경변수 기반 설정 사용. FTP 자격증명 하드코딩(EVNEST 결함) 없음.

---

## 3. 메시지별 갭 매트릭스

### 3.1 CP → CSMS (10개)

| 메시지 | Pvpentech 처리 | 주요 갭 |
|---|---|---|
| BootNotification | ⚠️ | Pending 상태 미지원, chargePointSerialNumber는 저장(`serialNumber` 컬럼 존재), iccid/imsi/meterType/meterSerialNumber 미저장 |
| Heartbeat | ✅ | last_heartbeat_at 갱신 정상 |
| Authorize | ⚠️ | expiryDate 응답 미포함(`authorizeHandler:32`: `{ idTagInfo: { status } }` — expiryDate 없음) |
| StartTransaction | ⚠️ | connectorId 정상 처리, reservationId 미처리, timestamp 파싱 단순(`new Date(p.timestamp)`), RFID 직접 시작 시 ocppTransactionId 미설정 |
| StopTransaction | ⚠️ | transactionId로 매칭, reason 저장 부분적(`failReason`에 일부만), transactionData 완전 미처리 |
| MeterValues | ⚠️ | 다측정값 저장 O, context/format/location 컬럼 없음, transactionId 매칭 미사용 |
| StatusNotification | ⚠️ | 9개 상태 처리 O, errorCode 저장 부분적(Faulted만 FaultLog), timestamp/vendorErrorCode 미저장 |
| DataTransfer | ⚠️ | 수신 O, 핸들러 레지스트리 없음, 무조건 Accepted |
| FirmwareStatusNotification | ❌ | 핸들러 없음 — handlerMap에 미등록, 충전기 메시지 수신 시 NotImplemented 회신 |
| DiagnosticsStatusNotification | ❌ | 핸들러 없음 — 동일 |

### 3.2 CSMS → CP (19개)

| 명령 | 빌더 | 응답 처리 | 주요 갭 |
|---|---|---|---|
| Reset | ✅ | ⚠️ 응답 반환O, DB저장X | OcppCommandResult 없음 |
| ChangeAvailability | ✅ | ⚠️ 동일 | |
| ChangeConfiguration | ❌ | — | 빌더 없음 |
| GetConfiguration | ❌ | — | 빌더 없음, 설정값 조회 불가 |
| ClearCache | ❌ | — | 빌더 없음 |
| RemoteStartTransaction | ✅ | ✅ status 반환 | 응답 DB 저장 없음 |
| RemoteStopTransaction | ✅ | ✅ status 반환 | 응답 DB 저장 없음 |
| UnlockConnector | ❌ | — | 빌더 없음 |
| TriggerMessage | ❌ | — | 빌더 없음 |
| GetDiagnostics | ❌ | — | 빌더 없음 |
| UpdateFirmware | ❌ | — | 빌더 없음 |
| ReserveNow | ❌ | — | 빌더 없음 |
| CancelReservation | ❌ | — | 빌더 없음 |
| GetLocalListVersion | ❌ | — | 빌더 없음 |
| SendLocalList | ❌ | — | 빌더 없음 |
| SetChargingProfile | ❌ | — | 빌더 없음 |
| ClearChargingProfile | ❌ | — | 빌더 없음 |
| GetCompositeSchedule | ❌ | — | 빌더 없음 |
| DataTransfer (→CP) | ❌ | — | 빌더 없음 |

---

## 4. 데이터 모델 갭

### 스펙 §4의 16개 권장 테이블 vs 현행 prisma/schema.prisma

| 스펙 테이블 | 현행 대응 | 상태 | 마이그레이션 규모 |
|---|---|---|---|
| Company | PartnerProfile (partner/site 구조로 대체) | 기능 충족, 구조 차이 | — |
| Charger | ChargingStation | ✅ 존재, tariff_id 없음 | S(컬럼 추가) |
| Connector | Connector | ✅ 존재 | — |
| ConnectorStatus | Connector.currentStatus + statusNotification 처리 | ⚠️ timestamp/vendorErrorCode 미저장 | S |
| Transaction | Transaction | ✅ 존재, stop_reason 컬럼 확인필요(failReason으로 대체) | — |
| MeterSample | MeterValue | ⚠️ context/format/location 컬럼 없음 | S |
| OcppMessageLog | OcppMessage | ✅ 존재 (direction int로 타입 구분) | — |
| PendingRequest | 없음(인메모리 Map) | ❌ 미존재 | M |
| OcppCommandResult | 없음 | ❌ 미존재 | S |
| Firmware | 없음 | ❌ 미존재 | L(관련 API 포함) |
| FirmwareCampaign | 없음 | ❌ 미존재 | M |
| FirmwareCampaignProgress | 없음 | ❌ 미존재 | M |
| DiagnosticsRequest | 없음 | ❌ 미존재 | S |
| Tariff | ChargingSite.unitPrice (단가는 Site 단위 관리) | 기능 충족, 구조 차이 | — |
| RoamingTariff | 해당 없음(현행 로밍 미운영) | — | — |
| PaymentJob/PaymentResult | PaymentOrder + RefundLog | ✅ 유사 구조 존재 | — |
| RelayLog | 없음 | ❌ 미존재 (DataTransfer 릴레이 미구현) | S |

**신규 테이블 필요 (마이그레이션 필요):**
- `PendingRequest` (M): 영속 명령 매칭 — 서버 재시작 내성
- `OcppCommandResult` (S): 명령 응답 영속화
- `Firmware` + `FirmwareCampaign` + `FirmwareCampaignProgress` (L): 펌웨어 관리 전체
- `DiagnosticsRequest` (S): 진단 요청 추적

**컬럼 추가 필요 (소규모 마이그레이션):**
- `MeterValue`: `context`, `format`, `location`
- `Connector`: `errorCode`, `info`, `vendorErrorCode`, `timestamp`
- `FaultLog`: `errorCode`

---

## 5. 단계별 구현 로드맵

스펙 §5의 8단계를 Pvpentech 현황에 맞게 재조정.

### Phase 1 — 즉시 (이미 충족, 확인만 필요)
- REQ-PROTO-001~003, REQ-TIME-001~002, REQ-SEC-001~002 완료.
- RFID 직접 시작 시 `ocppTransactionId` 미설정 버그 수정(`startTransaction.handler.ts:42`). 작업량 S.

### Phase 2 — 단기 (1~2주)
**포함 작업**:
- `FirmwareStatusNotification` 핸들러 추가 — 기존 구조에 파일 하나 추가. 작업량 S.
- `DiagnosticsStatusNotification` 핸들러 추가. 작업량 S.
- `MeterValue` 모델에 context/format/location 컬럼 추가 + 핸들러 갱신. 작업량 S.
- `Authorize` 응답에 `expiryDate` 추가. 작업량 S.
- `Connector` 모델에 errorCode/vendorErrorCode/timestamp 저장. 작업량 S.

**의존성**: 없음. 각각 독립 작업.
**PR 개수 예상**: 2~3개.

### Phase 3 — 중기 (2~4주)
**포함 작업**:
- `OcppCommandResult` 테이블 추가 + 기존 4개 빌더에 응답 영속화 추가. 작업량 M.
- 핵심 운영 명령 빌더 추가: GetConfiguration, ChangeConfiguration, ClearCache, TriggerMessage, UnlockConnector. 작업량 M.
- `StopTransaction` transactionData 처리. 작업량 S.

**의존성**: OcppCommandResult 스키마 → 빌더 응답 영속화 순.
**PR 개수 예상**: 3~4개.

### Phase 4 — 장기 (4~8주)
**포함 작업**:
- 펌웨어 관리 전체(REQ-FW-001~003): Firmware/Campaign 테이블 + UpdateFirmware 빌더 + 관리자 API. 작업량 L.
- 진단 전체(REQ-DIAG-001~002): DiagnosticsRequest 테이블 + GetDiagnostics 빌더 + 핸들러. 작업량 M.
- DataTransfer 핸들러 레지스트리(REQ-DT-001). 작업량 M.
- PendingRequest 영속화(REQ-PROTO-002 완전 충족). 작업량 M.

**의존성**: 펌웨어 관리는 스토리지(S3/CDN) 연동 선행.
**PR 개수 예상**: 5~6개.

### Phase 5 — 선택적 (8주+)
- ReserveNow, CancelReservation, SendLocalList, SetChargingProfile, ClearChargingProfile, GetCompositeSchedule 빌더. 작업량 M~L.
- 트랜잭션 상태 머신 확장(Authorized, Stopping 상태). 작업량 S.

---

## 6. 권장하지 않는 항목 (적용 시 오히려 복잡해지는 스펙)

### REQ-TENANT-001 (Company 엔티티 신설)
Pvpentech는 `PartnerProfile → ChargingSite → ChargingStation` 3계층으로 멀티테넌시 구현 완료. 스펙의 `Company` 엔티티는 `PartnerProfile`과 1:1 대응하므로, 별도 `Company` 테이블 추가는 불필요한 레이어 중복. 현행 구조 유지 권장.

### REQ-TARIFF-001 (요금제 테이블 별도 분리)
Pvpentech는 `ChargingSite.unitPrice` + `SitePriceHistory`로 단가 관리 중. cpnumber prefix 하드코딩 없음. 충전기 타입별 요금 차등이 필요해질 경우에만 `Tariff` 테이블 도입 검토. 현시점에서는 불필요.

### REQ-TARIFF-002 (PaymentResult 별도 테이블)
`PaymentOrder` 테이블과 `RefundLog`가 결제 흐름을 이미 추적 중. 추가 `PaymentResult` 테이블은 중복. 현행 유지.

### REQ-APP-001~002 (AppSession 모델 별도 분리)
`Transaction` 모델의 `sessionId` 필드가 앱 세션 역할을 수행하고 있어 별도 AppSession 테이블이 불필요. 동시성 및 멱등성은 `Transaction.sessionId` unique 제약으로 이미 보장.

---

## 7. 다음 작업 추천

**1순위: Phase 2 — FirmwareStatusNotification + DiagnosticsStatusNotification 핸들러 추가**
이유: 작업량 S이지만 충전기가 보내는 상태 메시지를 현재 CSMS가 NotImplemented로 거부하는 상황 — 충전기가 주기적으로 에러 응답을 받으면 재연결을 시도하여 불안정한 연결이 반복될 수 있음.

구체적 작업:
- `src/ocpp/handlers/firmwareStatusNotification.handler.ts` 신규 작성 (빈 `{}` 반환 + DB 로그 기록)
- `src/ocpp/handlers/diagnosticsStatusNotification.handler.ts` 신규 작성
- `src/ocpp/handlers/index.ts`에 두 핸들러 등록

**2순위: MeterValue 컬럼 추가 (context/format/location) + transactionId 매칭 개선**
이유: 현행 transactionId 매칭이 connectorId+Active 쿼리 방식이어서 동시 충전 시 데이터 오기록 가능. 작업량 S이지만 데이터 무결성에 직결.

**3순위: 핵심 운영 명령 빌더 (GetConfiguration, ChangeConfiguration, ClearCache)**
이유: 충전기 설정 조회/변경 불가로 운영자가 HeartbeatInterval, MeterValueSampleInterval 등 핵심 파라미터를 확인할 수 없음. 작업량 M.
