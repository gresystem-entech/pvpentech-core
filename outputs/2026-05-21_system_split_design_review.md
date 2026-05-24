# Pvpentech CSMS 시스템 분리 설계 검토

**작성일**: 2026-05-21  
**작성자**: Project Design Architect  
**대상 시스템**: Pvpentech CSMS (현재 브랜치: `fix/ocpp_message_log_all_directions`)  
**문서 목적**: 단일 모놀리스를 CSMS-Core / CSMS-Portal 2개 시스템으로 분리하는 타당성 검토 및 종합 설계 가이드

---

## 1. Executive Summary

### 1-1. 분리 목적 및 이점

| 구분 | 내용 |
|------|------|
| **목적 1: 독립 배포** | 충전기 게이트웨이 배포 시 포털 서비스 중단이 없어야 하고, 포털 기능 배포 시 OCPP WebSocket 연결이 재시작되지 않아야 한다 |
| **목적 2: 스케일 독립성** | 충전기 수 증가 → CSMS-Core 수평 확장. 사용자/포털 트래픽 급증 → CSMS-Portal 확장. 서로 다른 스케일링 수요 |
| **목적 3: 책임 경계 명확화** | OCPP 프로토콜 담당 팀과 비즈니스 로직 담당 팀이 독립 개발·릴리스 가능 |
| **목적 4: 장애 격리** | 결제/정산 서비스 장애가 충전기 통신까지 전파되는 것을 방지 |
| **이점 1** | CSMS-Core는 stateless HTTP보다 long-lived WebSocket 최적화에 집중 가능 |
| **이점 2** | CSMS-Portal은 비즈니스 기능 추가·수정 시 OCPP 영향도 0 |
| **이점 3** | 각 시스템 별도 테스트 환경 구성 용이, OCPP 적합성 테스트(OCTT)와 API 통합 테스트 분리 가능 |

### 1-2. 분리 리스크

| 리스크 | 수준 | 핵심 사유 |
|--------|------|-----------|
| **Transaction 경계 분리** | 높음 | 현재 StopTransaction → 요금계산 → refund 트리거가 단일 프로세스 내 동기 흐름. 시스템 간 Saga 패턴 도입 필요 |
| **분산 모놀리스** | 중간 | 경계를 잘못 그으면 API 호출이 단순 함수 호출을 대체하는 것뿐이어서 복잡도만 증가 |
| **운영 복잡도** | 중간 | 배포, 로그 집계, 분산 트레이싱, 두 시스템 버전 매트릭스 관리 필요 |
| **connectionManager 메모리 공유** | 높음 | 현재 in-process Map으로 관리. 다중 인스턴스 시 stationId 라우팅 레이어(Redis pub/sub 또는 sticky routing) 필수 |
| **PnC 코드 귀속** | 중간 | ISO 15118 PnC 기능은 OCPP DataTransfer 로 구현되어 있어 CSMS-Core에 속하지만, 제거 요건에 따라 별도 처리 필요 |

### 1-3. 아키텍트 입장: 분리 권장 여부

> **권장 결론: 점진적 분리 (Phase 1→4 단계적 진행) 권장. 즉각적 repo 분리는 보류.**

현재 코드베이스 상태를 분석한 결과:

1. `charge.service.ts`가 `@ocpp/commands`를 직접 import하여 `sendRemoteStartTransaction`을 호출한다. 이 결합이 가장 핵심 분리 포인트이며, HTTP 어댑터로 치환 가능하지만 추가적인 비동기 처리(응답 대기, 타임아웃)를 반드시 설계해야 한다.

2. `stopTransaction.handler.ts`가 `refundService`와 `postChargeBillingQueue`를 직접 사용한다. 분리 시 이 흐름은 이벤트 발행(Core → Portal)으로 바꿔야 하는 가장 복잡한 지점이다.

3. `connectionManager`가 in-process `Map`이므로 CSMS-Core 멀티 인스턴스 운영 전에 Redis 기반 stationId 라우팅으로 전환이 선행되어야 한다.

**대안으로 모듈러 모놀리스를 유지하면서 명확한 내부 인터페이스 경계만 강제하는 방식도 공정한 대안이다.** (섹션 10 참조)

---

## 2. 현재 시스템 인벤토리

### 2-1. 라우트/컨트롤러/서비스/잡 카테고리별 분류

#### OCPP 게이트웨이 (시스템 1 후보)

| 레이어 | 파일/모듈 | 설명 |
|--------|-----------|------|
| **OCPP Server** | `src/ocpp/server.ts` | WebSocketServer 초기화, verifyClient(Basic Auth), 연결 등록/해제 |
| **Connection Manager** | `src/ocpp/connectionManager.ts` | in-process Map으로 stationId → WebSocket 매핑 |
| **Message Router** | `src/ocpp/messageRouter.ts` | OCPP Call/CallResult/CallError 라우팅 |
| **Message Parser** | `src/ocpp/messageParser.ts` | OCPP JSON 직렬화/역직렬화 |
| **Schema Validator** | `src/ocpp/schemaValidator.ts` | OCPP 메시지 스키마 검증 |
| **Pending Requests** | `src/ocpp/pendingRequests.ts` | 응답 대기 중인 CSMS→CP 요청 추적 |
| **Handler: BootNotification** | `src/ocpp/handlers/bootNotification.handler.ts` | BootNotification 처리 |
| **Handler: Heartbeat** | `src/ocpp/handlers/heartbeat.handler.ts` | Heartbeat 처리 |
| **Handler: StatusNotification** | `src/ocpp/handlers/statusNotification.handler.ts` | 커넥터 상태 갱신 + OfflineLog 기록 |
| **Handler: StartTransaction** | `src/ocpp/handlers/startTransaction.handler.ts` | 거래 시작 — 정산 snapshot 기록 포함 |
| **Handler: StopTransaction** | `src/ocpp/handlers/stopTransaction.handler.ts` | 거래 종료 — **refundService, postChargeBillingQueue 직접 사용** (분리 시 주요 결합점) |
| **Handler: MeterValues** | `src/ocpp/handlers/meterValues.handler.ts` | 계량 데이터 저장 |
| **Handler: Authorize** | `src/ocpp/handlers/authorize.handler.ts` | RFID 인증 |
| **Handler: DataTransfer** | `src/ocpp/handlers/dataTransfer.handler.ts` | DataTransfer 레지스트리 (PnC 포함) |
| **Handler: FirmwareStatusNotification** | `src/ocpp/handlers/firmwareStatusNotification.handler.ts` | 펌웨어 상태 갱신 |
| **Handler: DiagnosticsStatusNotification** | `src/ocpp/handlers/diagnosticsStatusNotification.handler.ts` | 진단 상태 갱신 |
| **Command: RemoteStart/Stop** | `src/ocpp/commands/remoteStartTransaction.command.ts` 등 | CSMS→CP 명령 발신 |
| **Command: Reset, ChangeConfiguration, GetConfiguration** | `src/ocpp/commands/*.command.ts` | CSMS→CP 각종 제어 명령 |
| **Command: UpdateFirmware, GetDiagnostics** | `src/ocpp/commands/updateFirmware.command.ts` 등 | 펌웨어/진단 명령 |
| **Command: UnlockConnector, ChangeAvailability** | `src/ocpp/commands/*.command.ts` | 커넥터 제어 |
| **Command: DataTransfer, TriggerMessage** | `src/ocpp/commands/*.command.ts` | DataTransfer, TriggerMessage |
| **Scheduler: OcppCommandSweeper** | `src/jobs/schedulers/ocppCommandSweeper.scheduler.ts` | 미응답 OCPP 명령 타임아웃 처리 |
| **Scheduler: SessionTimeout** | `src/jobs/processors/sessionTimeout.processor.ts` | 세션 타임아웃 처리 |

#### ISO 15118 PnC (명시적 제거 대상)

| 레이어 | 파일 | 설명 |
|--------|------|------|
| **PnC Config** | `src/config/pnc.ts` | PNC_VENDOR_ID, PKI 설정 상수, `isPkiEnabled()` |
| **PnC Handler: Authorize** | `src/ocpp/handlers/pnc/authorize.handler.ts` | PnC DataTransfer Authorize 처리 |
| **PnC Handler: SignCertificate** | `src/ocpp/handlers/pnc/signCertificate.handler.ts` | CSR 처리, PKI 연동 |
| **PnC Handler: Get15118EvCertificate** | `src/ocpp/handlers/pnc/get15118EvCertificate.handler.ts` | EV 인증서 제공 |
| **PnC Handler: GetCertificateStatus** | `src/ocpp/handlers/pnc/getCertificateStatus.handler.ts` | OCSP 인증서 상태 조회 |
| **PnC Handler Registry** | `src/ocpp/handlers/pnc/index.ts` | 4개 PnC DataTransfer 핸들러 등록 |
| **PnC Command** | `src/ocpp/commands/pncSend.command.ts` | CSMS→CP PnC 명령 발신 |
| **PnC PKI Service** | `src/services/pncPki.service.ts` | 사내 V2G PKI REST 클라이언트 |
| **PnC OCSP Service** | `src/services/pncOcsp.service.ts` | OCSP 인증서 상태 확인 |
| **PnC Audit Log Service** | `src/services/pncAuditLog.service.ts` | PnC 감사 로그 기록 |
| **PnC Config Service** | `src/services/pncConfig.service.ts` | 충전기별 PnC OCPP 설정 적용 |
| **PnC Cert Expiry Service** | `src/services/pncCertExpiry.service.ts` | EVSE Leaf 인증서 만료 모니터링 |
| **PnC Cert Expiry Scheduler** | `src/jobs/schedulers/pncCertExpiry.scheduler.ts` | 인증서 만료 일별 스캔 |
| **OCSP Util** | `src/utils/ocspRequest.ts` | OCSP 요청 유틸리티 |
| **ASN1 Util** | `src/utils/asn1.ts` | ASN.1 파싱 유틸리티 |
| **PnC Portal Routes** | `src/routes/portal/cs/pncOps.routes.ts` | CS 포털 PnC 운영 API |
| **PnC Audit Log Route** | `src/routes/portal/cs/idTokens.routes.ts` (PnC 관련 부분) | IdToken/eMAID 관리 |
| **DB 모델** | `PncInstalledCertificate`, `PncCsrInProgress`, `PncAuditLog` | PnC 관련 DB 테이블 (schema.prisma) |

#### 충전기 관리 (시스템 1 후보)

| 레이어 | 파일 | 설명 |
|--------|------|------|
| **Station Service** | `src/services/station.service.ts` | 충전기 CRUD, 연결 상태 조회 |
| **Station Controller** | `src/controllers/station.controller.ts` | 충전기 관리 HTTP 핸들러 |
| **Station Repository** | `src/repositories/station.repository.ts` | 충전기 DB 조회 |
| **Provisioning Service** | `src/services/provision.service.ts` | 충전기 최초 등록/프로비저닝 |
| **Provision Controller** | `src/controllers/provision.controller.ts` | `/auths` 엔드포인트 |
| **Provision Route** | `src/routes/provision.routes.ts` | 프로비저닝 라우트 |
| **Provisioning Repository** | `src/repositories/provisioning.repository.ts` | 프로비저닝 DB 조회 |
| **Firmware Service** | `src/services/firmware.service.ts` | 펌웨어 파일 관리, UpdateFirmware 명령 |
| **FirmwareCampaign Service** | `src/services/firmwareCampaign.service.ts` | 펌웨어 일괄 업데이트 캠페인 |
| **Firmware Controller** | `src/controllers/firmware.controller.ts` | 펌웨어 업로드/다운로드 |
| **Firmware Repository** | `src/repositories/firmware.repository.ts` | 펌웨어 DB 조회 |
| **ChargerConfig Service** | `src/services/chargerConfig.service.ts` | 충전기 key-value 설정 관리 |
| **FaultLog Service** | `src/services/faultLog.service.ts` | 충전기 장애 로그 |
| **FaultLog Repository** | `src/repositories/faultLog.repository.ts` | 장애 로그 DB 조회 |
| **Manufacturer Service** | `src/services/manufacturer.service.ts` | 충전기 제조사 관리 |
| **Manufacturer Controller** | `src/controllers/manufacturer.controller.ts` | 제조사 CRUD |
| **Manufacturer Repository** | `src/repositories/manufacturer.repository.ts` | 제조사 DB 조회 |
| **OcppMessage Service** | `src/services/ocppMessage.service.ts` | OCPP 메시지 로그 조회 |
| **OcppMessage Repository** | `src/repositories/ocppMessage.repository.ts` | OCPP 메시지 DB 조회 |
| **OcppCommandResult Service** | `src/services/ocppCommandResult.service.ts` | OCPP 명령 결과 조회 |
| **MeterValue Repository** | `src/repositories/meterValue.repository.ts` | 계량 데이터 DB 조회 |

#### 비즈니스/포털 (시스템 2 후보)

| 레이어 | 파일 | 설명 |
|--------|------|------|
| **Charge Service** | `src/services/charge.service.ts` | 충전 시작/중지 — **ocpp commands 직접 import** (분리 시 핵심 결합) |
| **Charge Controller** | `src/controllers/charge.controller.ts` | 모바일 앱 충전 API |
| **Charge Routes** | `src/routes/charge.routes.ts` | `/api/charge/*` |
| **Payment Service** | `src/services/payment.service.ts` | PG 결제 처리 (MB Bank) |
| **Payment Controller** | `src/controllers/payment.controller.ts` | 결제 API |
| **Payment Routes** | `src/routes/payment.routes.ts` | `/api/payment/*` |
| **PgConfig Service** | `src/services/pgConfig.service.ts` | PG 설정 관리 |
| **PgConfig Controller** | `src/controllers/pgConfig.controller.ts` | PG 설정 CRUD |
| **Settlement Service** | `src/services/settlement.service.ts` | 정산 생성/MB Bank 송금 |
| **Settlement Repository** | `src/repositories/settlement.repository.ts` | 정산 DB 조회 |
| **Refund Service** | `src/services/refund.service.ts` | 환불 생성/PG 환불 호출 |
| **MbBank Transfer Service** | `src/services/mbbank-transfer.service.ts` | MB Bank 송금 API 클라이언트 |
| **User Service** | `src/services/user.service.ts` | 회원 관리 |
| **Auth Service** | `src/services/auth.service.ts` | 인증/JWT |
| **Auth Controller** | `src/controllers/auth.controller.ts` | 로그인/회원가입 |
| **Auth Routes** | `src/routes/auth.routes.ts` | `/api/auth/*`, `/api/portal/auth/*` |
| **Partner Service** | `src/services/partner.service.ts` | 파트너 관리 |
| **Partner Controller** | `src/controllers/partner.controller.ts` | 파트너 CRUD |
| **Partner Repository** | `src/repositories/partner.repository.ts` | 파트너 DB 조회 |
| **Site Service** | `src/services/site.service.ts` | 충전소(Site) 관리 |
| **Site Controller** | `src/controllers/site.controller.ts` | Site CRUD |
| **Session Service** | `src/services/session.service.ts` | 세션 조회/관리 |
| **Session Controller** | `src/controllers/session.controller.ts` | 세션 API |
| **Stats Service** | `src/services/stats.service.ts` | 통계 조회 |
| **Stats Controller** | `src/controllers/stats.controller.ts` | 통계 API |
| **Notification Service** | `src/services/notification.service.ts` | 다국어 알림 메시지 생성 |
| **CS Portal Routes** | `src/routes/portal/cs/` (20개 파일) | CS 관리자 포털 전체 API |
| **Partner Portal Routes** | `src/routes/portal/partner/` (6개 파일) | 파트너 포털 API |
| **Customer Portal Routes** | `src/routes/portal/customer/` (5개 파일) | 고객 포털 API |
| **Transaction Repository** | `src/repositories/transaction.repository.ts` | 거래 DB 조회 |
| **IdToken Repository** | `src/repositories/idToken.repository.ts` | RFID/IdToken DB 조회 |

#### 배치 잡 (Jobs)

| 잡 | 파일 | 귀속 시스템 |
|----|------|------------|
| **ChargeGoal** Processor | `jobs/processors/chargeGoal.processor.ts` | Core (충전 목표 모니터링) → 단, 목표 달성 시 `chargeService.stopCharge()` 호출하므로 결합점 |
| **SessionTimeout** Processor | `jobs/processors/sessionTimeout.processor.ts` | Core |
| **OcppLogCleanup** Processor | `jobs/processors/ocppLogCleanup.processor.ts` | Core |
| **OcppCommandSweeper** Scheduler | `jobs/schedulers/ocppCommandSweeper.scheduler.ts` | Core |
| **PostChargeBilling** Processor | `jobs/processors/postChargeBilling.processor.ts` | Portal (충전 후 결제) |
| **RefundDispatch** Processor | `jobs/processors/refundDispatch.processor.ts` | Portal (환불 배치) |
| **RefundAttempt** Processor | `jobs/processors/refundAttempt.processor.ts` | Portal (환불 시도) |
| **Settlement** Processor | `jobs/processors/settlement.processor.ts` | Portal (정산 배치) |
| **Daily Scheduler** | `jobs/schedulers/daily.scheduler.ts` | Portal (정산/환불 트리거) |
| **PncCertExpiry** Scheduler | `jobs/schedulers/pncCertExpiry.scheduler.ts` | 제거 대상 (PnC) |

### 2-2. Prisma 모델별 귀속 시스템 분류

#### 시스템 1 (CSMS-Core) 전용

| 모델 | 설명 |
|------|------|
| `ChargingStation` | 충전기 마스터 |
| `Connector` | 커넥터 상태 |
| `DeviceVariable` | 충전기 OCPP 설정 변수 |
| `OcppMessage` | OCPP 메시지 로그 |
| `OcppCommandResult` | CSMS→CP 명령 결과 |
| `DiagnosticsRequest` | 진단 요청 추적 |
| `Firmware` | 펌웨어 파일 메타데이터 |
| `FirmwareCampaign` | 펌웨어 일괄 업데이트 캠페인 |
| `FirmwareCampaignProgress` | 캠페인 진행 상황 |
| `FaultLog` | 충전기 장애 로그 |
| `OfflineLog` | 충전기 오프라인 이력 |
| `Manufacturer` | 충전기 제조사 |
| `ChargerProvisioning` | 프로비저닝 이력 |
| `StationIdSequence` | 충전기 ID 시퀀스 |
| `ChargerConfig` | 충전기 key-value 설정 |

#### 시스템 2 (CSMS-Portal) 전용

| 모델 | 설명 |
|------|------|
| `User` | 회원 |
| `PartnerProfile` | 파트너 사업자 프로파일 |
| `PaymentCard` | 결제 카드 |
| `Settlement` | 정산 레코드 |
| `RefundLog` | 환불 이력 |
| `RefundAttempt` | 환불 시도 이력 |
| `PgConfig` | PG 설정 |
| `PaymentOrder` | 결제 주문 |
| `CsmsVariable` | 시스템 운영 변수 |
| `SitePriceHistory` | 충전소 단가 이력 |

#### 양쪽 필요 — 가장 복잡한 분리 대상

| 모델 | Master 후보 | 이유 / 결합 지점 |
|------|------------|-----------------|
| `Transaction` | **Core** | OCPP StartTransaction/StopTransaction이 생성·갱신하는 원천 데이터. Portal은 결제/정산/환불에서 동일 레코드를 갱신(`paymentStatus`, `costVnd`, `settlementId`) |
| `MeterValue` | **Core** | OCPP MeterValues 핸들러가 삽입. Portal 통계에서 집계 읽기 필요 |
| `ChargingSite` | **Portal** | 파트너가 소유하는 비즈니스 엔티티. 단, Core의 `ChargingStation.siteId` 및 단가 조회에 필요 |
| `IdToken` | **Core** | Authorize 핸들러에서 조회. Portal에서 RFID 카드 관리(CRUD) |

> **[결정 필요 #1]** `Transaction` 모델의 `paymentStatus`, `costVnd`, `settlementId` 필드를 Core DB에 남길지, Portal 전용 `ChargeSession` 투영 테이블을 만들지 결정해야 한다.

#### 제거 대상 모델 (ISO 15118 PnC)

| 모델 | 위치 | 조치 |
|------|------|------|
| `PncInstalledCertificate` | schema.prisma | 제거 |
| `PncCsrInProgress` | schema.prisma | 제거 |
| `PncAuditLog` | schema.prisma | 제거 |

### 2-3. TLS 1.3 / ISO 15118 코드 흔적

코드베이스 전체를 `TLS`, `tls 1.`, `tlsVersion`, `ssl` 키워드로 grep한 결과 **TLS 1.3 구현 코드는 없음**. Node.js HTTP/WebSocket 서버의 기본 TLS 설정은 OS/Node.js 런타임에 위임되며, 코드 레벨에서 TLS 버전을 명시한 흔적은 없다.

**ISO 15118 / PnC 코드 흔적 (실제 존재)** — 아래 위치에 구현되어 있으며 모두 제거 대상:

```
src/config/pnc.ts                            — PNC_VENDOR_ID, PKI/OCSP 설정 상수
src/config/env.ts                            — PKI_BASE_URL, OCSP_BASE_URL, PKI_API_KEY 등 8개 환경변수
src/ocpp/handlers/pnc/                       — 4개 DataTransfer 핸들러 (Authorize/SignCertificate/Get15118EvCertificate/GetCertificateStatus)
src/ocpp/commands/pncSend.command.ts         — PnC CSMS→CP 명령 발신
src/services/pncPki.service.ts               — 사내 V2G PKI REST 클라이언트
src/services/pncOcsp.service.ts              — OCSP 인증서 상태 확인
src/services/pncAuditLog.service.ts          — PnC 감사 로그
src/services/pncConfig.service.ts            — 충전기 PnC 설정 관리
src/services/pncCertExpiry.service.ts        — 인증서 만료 모니터링
src/utils/ocspRequest.ts                     — OCSP 요청 유틸리티
src/utils/asn1.ts                            — ASN.1 파싱 유틸리티
src/jobs/schedulers/pncCertExpiry.scheduler.ts — 만료 일별 스캔
src/routes/portal/cs/pncOps.routes.ts        — CS 포털 PnC 운영 API
src/server.ts:                               — logPncConfigOnce(), registerPncHandlers(), startPncCertExpiryScheduler()
prisma/schema.prisma:                        — PncInstalledCertificate, PncCsrInProgress, PncAuditLog 3개 모델
documents/design_guide/csms_pnc_implementation_spec_2026-05-11.md — 설계 문서
```

총 **15개 파일 + 3개 DB 모델** + 1개 환경변수 그룹이 PnC 관련. `server.ts`에서 `registerPncHandlers()`, `startPncCertExpiryScheduler()`, `logPncConfigOnce()` 세 호출을 제거하면 핸들러 등록이 비활성화된다. 단, `dataTransfer.handler.ts`는 PnC를 제거해도 다른 DataTransfer 용도로 사용되므로 레지스트리 자체는 유지, PnC 등록 코드만 제거.

---

## 3. 분리 후 시스템 1 (CSMS-Core) 명세

### 3-1. 책임 범위 (Bounded Context)

**"충전기와 OCPP 1.6 프로토콜로 통신하고, 그 결과를 영속화하는 게이트웨이"**

- 충전기(Charge Point)와의 WebSocket 연결 수립 및 유지
- OCPP 1.6 메시지 수신 처리 (CP→CSMS Call)
- OCPP 1.6 명령 발신 (CSMS→CP Call)
- 충전기 등록/프로비저닝 (제조사 인증 포함)
- 충전기 상태, 커넥터 상태, 트랜잭션 원본 데이터 관리
- OCPP 메시지 로그, 명령 결과 감사 저장
- 펌웨어 파일 서빙 및 업데이트 캠페인

### 3-2. 포함 기능 목록

**OCPP 1.6 CP→CSMS 핸들러 (수신)**

| Action | 파일 | 설명 |
|--------|------|------|
| BootNotification | `bootNotification.handler.ts` | 충전기 부팅 등록 |
| Heartbeat | `heartbeat.handler.ts` | 생존 신호 |
| StatusNotification | `statusNotification.handler.ts` | 커넥터 상태 변경 |
| StartTransaction | `startTransaction.handler.ts` | 충전 시작 기록 |
| StopTransaction | `stopTransaction.handler.ts` | 충전 종료 기록 + 이벤트 발행 |
| MeterValues | `meterValues.handler.ts` | 계량 데이터 저장 |
| Authorize | `authorize.handler.ts` | RFID 인증 |
| DataTransfer | `dataTransfer.handler.ts` | 확장 메시지 처리 |
| FirmwareStatusNotification | `firmwareStatusNotification.handler.ts` | 펌웨어 상태 갱신 |
| DiagnosticsStatusNotification | `diagnosticsStatusNotification.handler.ts` | 진단 상태 갱신 |

**OCPP 1.6 CSMS→CP 명령 (발신)**

| Action | 설명 |
|--------|------|
| RemoteStartTransaction | 원격 충전 시작 |
| RemoteStopTransaction | 원격 충전 중지 |
| Reset (Soft/Hard) | 충전기 리셋 |
| ChangeAvailability | 커넥터 가용성 변경 |
| ChangeConfiguration | OCPP 설정 값 변경 |
| GetConfiguration | OCPP 설정 값 조회 |
| ClearCache | 인증 캐시 삭제 |
| UnlockConnector | 커넥터 잠금 해제 |
| UpdateFirmware | 펌웨어 업데이트 명령 |
| GetDiagnostics | 진단 파일 업로드 요청 |
| TriggerMessage | 메시지 강제 재전송 요청 |
| DataTransfer | 확장 메시지 발신 |
| ReserveNow | 예약 (구현 예정) |
| CancelReservation | 예약 취소 (구현 예정) |
| SendLocalList | 로컬 인증 목록 전송 (구현 예정) |
| GetLocalListVersion | 로컬 목록 버전 조회 (구현 예정) |

**충전기 관리 API (CSMS-Portal로 노출)**

- 충전기 목록/상세 조회, 상태 조회
- 커넥터 상태 조회
- OCPP 명령 결과 조회
- OCPP 메시지 로그 조회
- 프로비저닝 관리 (사전 등록, 승인, 취소)
- 제조사 관리 (채널/토큰 발급)
- 펌웨어 업로드/캠페인 관리
- 충전기 설정 (ChargerConfig) 관리
- 장애 로그 조회
- 진단 요청 관리

### 3-3. 명시적 제외

| 제외 항목 | 이유 |
|-----------|------|
| **ISO 15118 (Plug & Charge)** | 프로젝트 오너 요구사항 — 전면 제거 |
| **DIN 70121** | ISO 15118 선행 규격, 동일하게 제외 |
| **V2G PKI 연동** | PnC 제거에 따라 함께 제거 |
| **OCSP 인증서 상태 확인** | PnC 제거에 따라 함께 제거 |
| **인증서 관리 (CSR/PEM)** | PnC 제거에 따라 함께 제거 |
| **TLS 1.3 직접 구성** | 현재 구현 없음. 인프라(nginx/LoadBalancer) 레벨에서 처리 권장 |
| **결제/정산/환불** | CSMS-Portal 전용 |
| **회원/인증 (User JWT)** | CSMS-Portal 전용. Core는 충전기 OCPP Basic Auth만 처리 |
| **알림/푸시** | CSMS-Portal 전용 |

### 3-4. 자체 보유 DB 스키마 제안 (시스템 1)

```
CSMS-Core DB (core DB)
├── charging_station          — 충전기 마스터 (stationId, status, passwordHash 등)
├── connector                 — 커넥터 상태
├── transaction               — 충전 거래 원본 (meterStart, meterEnd, timeStart, timeEnd, costVnd 등)
│   └── [paymentStatus, settlementId 필드는 삭제 또는 Core에서 읽기 전용]
├── meter_value               — 계량 시계열 데이터
├── device_variable           — OCPP 설정 변수 (GetConfiguration 결과)
├── ocpp_message              — OCPP 메시지 로그 (감사)
├── ocpp_command_result       — CSMS→CP 명령 결과 (감사)
├── diagnostics_request       — 진단 파일 업로드 요청 추적
├── firmware                  — 펌웨어 파일 메타데이터
├── firmware_campaign         — 펌웨어 일괄 업데이트 캠페인
├── firmware_campaign_progress — 캠페인 진행 상황
├── fault_log                 — 충전기 장애 로그
├── offline_log               — 오프라인 이력
├── manufacturer              — 충전기 제조사
├── charger_provisioning      — 프로비저닝 이력
├── station_id_sequence       — 충전기 ID 시퀀스
├── charger_config            — 충전기 key-value 설정
└── id_token                  — RFID/IdToken 인증 정보 (Master: Core)
```

> `ChargingSite` 제거 권장 — 단가(unitPrice)는 Core가 Portal에서 API로 조회하거나, 단가 조회 결과를 Transaction 생성 시 payload로 Portal이 전달하는 방식으로 결합 제거.

### 3-5. 외부 노출 인터페이스

```
CSMS-Core 외부 인터페이스

① WebSocket (충전기 측)
   - WS: wss://core.pvpentech.com/{stationId}
   - 프로토콜: OCPP 1.6 (subprotocol: "ocpp1.6")
   - 인증: Basic Auth (stationId + passwordHash)

② HTTP REST API (CSMS-Portal → Core 제어)
   - Base: https://core-internal.pvpentech.com/api/internal/v1
   - 인증: 서비스 토큰 (HMAC-SHA256 또는 API Key)
   - 상세: 섹션 6 참조

③ 이벤트 발행 (Core → Portal)
   - 방식: Redis Stream 또는 RabbitMQ
   - 이벤트 목록: 섹션 6 참조

④ 펌웨어 파일 서빙 (충전기 직접 다운로드)
   - HTTP: https://core.pvpentech.com/firmware/:filename
   - 인증: 없음 (filename 패턴 검증으로 디렉토리 트래버설 방지)

⑤ 프로비저닝 (제조사 측)
   - POST https://core.pvpentech.com/auths
   - 인증: x-token / x-channel 헤더
```

### 3-6. 운영 요구사항

| 요구사항 | 현재 상태 | 분리 후 필요 조치 |
|----------|-----------|-----------------|
| **메시지 손실 방지** | `pendingRequests.ts` in-process 추적 + DB `OcppCommandResult` | Redis 기반 pendingRequests로 전환 (멀티 인스턴스 공유) |
| **응답 타임아웃** | `OCPP_RESPONSE_TIMEOUT_MS=30000`, OcppCommandSweeper | 유지 |
| **재연결 처리** | `connectionManager.register()`에서 기존 연결 terminate 후 재등록 | 멀티 인스턴스 시 stationId sticky routing 필요 |
| **멀티 인스턴스 stationId 라우팅** | 현재 in-process Map — 단일 인스턴스만 지원 | **[결정 필요 #2]** Redis pub/sub 또는 Sticky session (nginx) 방식 선택 |
| **Idempotency** | `OcppCommandResult.messageId UNIQUE` | 유지 |

---

## 4. 분리 후 시스템 2 (CSMS-Portal) 명세

### 4-1. 책임 범위 (Bounded Context)

**"충전 서비스 비즈니스 운영을 위한 포털 — OCPP 프로토콜을 알지 않고 Core API만 호출"**

- 모바일 앱 충전 세션 생성/관리 (Core API 호출로 실제 충전 제어)
- 결제/정산/환불 처리 (MB Bank PG 연동)
- 회원/파트너 관리, 인증
- 충전소(Site)/요금제 관리
- CS 관리자 포털, 파트너 포털, 고객 포털
- 통계/대시보드
- 캠페인 관리 (CS 포털에서 이미 구현됨 — stations 대상 선택 등)
- 다국어(i18n) 지원
- 알림/푸시 메시지
- 감사 로그

### 4-2. 포함 기능

| 카테고리 | 기능 |
|----------|------|
| **모바일 앱 API** | `/api/charge/*` (충전 시작/중지/상태) — Core API 호출로 구현. `/api/payment/*` (결제) |
| **CS 관리자 포털** | 대시보드, 파트너/사이트/충전기 관리(조회는 Core 데이터 활용), 사용자 관리, 정산, 환불, PG 설정, 운영 설정 |
| **파트너 포털** | 대시보드, 사이트/충전기 조회, 정산 조회, 은행 계좌 관리, 통계 |
| **고객 포털** | 충전 이력, 결제 카드 관리, RFID 카드 관리, 프로필 |
| **인증/권한** | JWT 발급/검증, 역할(cs/partner/customer), 회원가입, 승인 흐름 |
| **결제** | MB Bank PG 결제 주문 생성, IPN 수신, 결제 상태 관리 |
| **정산** | 파트너별 정산 배치 (daily/weekly/monthly), MB Bank 송금 |
| **환불** | 충전 후 환불 배치, 재시도 (Exponential Backoff), 환불 시도 이력 |
| **통계** | 충전량, 매출, 파트너별/사이트별 집계 |
| **다국어** | Accept-Language 기반 ko/en/vi 메시지 반환 |
| **알림** | 충전 목표 달성, 결제 완료, 환불 완료 등 메시지 |

### 4-3. 자체 보유 DB 스키마 제안 (시스템 2)

```
CSMS-Portal DB (portal DB)
├── user                      — 회원 (cs/partner/customer)
├── partner_profile           — 파트너 사업자 정보, 정산 설정
├── payment_card              — 결제 카드 (billingKey)
├── charging_site             — 충전소 (단가, 파트너 FK)
├── site_price_history        — 단가 변경 이력
├── settlement                — 정산 레코드 (partnerId → core DB stationId 참조)
├── refund_log                — 환불 이력 (transactionId → core DB logical FK)
├── refund_attempt            — 환불 시도 이력
├── payment_pg_config         — PG 설정
├── payment_order             — 결제 주문 (sessionId → core DB logical FK)
├── csms_variable             — 시스템 운영 변수
├── charge_session_projection  — [신규] Core의 Transaction을 Portal에서 조회/집계하기 위한 읽기 전용 투영 테이블
│   (transactionId, sessionId, stationId, siteId, partnerId, status, costVnd, paymentStatus 등)
└── id_token                  — [복사본 또는 Core API 경유] RFID 카드 관리
```

> `charge_session_projection`은 Core에서 이벤트(TransactionStarted, TransactionStopped)를 받아 Portal이 자체 DB에 투영(Projection)을 유지하는 방식. 이를 통해 정산/통계/이력 쿼리가 Core에 실시간 의존하지 않아도 된다.

### 4-4. 충전기 제어 흐름 변경

현재:
```
ChargeService.startCharge()
  └─ sendRemoteStartTransaction()  ← 직접 import (@ocpp/commands)
```

분리 후:
```
ChargeService.startCharge()
  └─ CoreApiClient.post('/api/internal/v1/sessions/start', { stationId, idTag, connectorId })
       └─ CSMS-Core: RemoteStartTransaction 발신
```

---

## 5. 데이터 분리 전략

### 5-1. Transaction/Session — 양쪽이 모두 필요한 핵심 엔티티

**결정: Transaction Master는 CSMS-Core. Portal은 투영(Projection) 유지.**

```
┌────────────────────────────────────────────────────────────────────┐
│  CSMS-Core DB                    CSMS-Portal DB                   │
│                                                                    │
│  transaction (master)            charge_session_projection         │
│  ├── id (PK)           ──────►  ├── coreTransactionId (PK)        │
│  ├── sessionId                  ├── sessionId                     │
│  ├── stationId                  ├── stationId                     │
│  ├── connectorId                ├── siteId (비정규화)              │
│  ├── idTag                      ├── partnerId (비정규화)           │
│  ├── status                     ├── status                        │
│  ├── meterStart/End             ├── totalKwh                      │
│  ├── timeStart/End              ├── costVnd                       │
│  ├── costVnd                    ├── paymentStatus                 │
│  ├── unitPriceVnd               ├── unitPriceVnd                  │
│  ├── marginRate                 ├── marginRate                    │
│  └── settlementSnapshot fields  └── updatedAt                     │
│                                                                    │
│  이벤트 흐름: TransactionStarted/Stopped → Portal이 투영 갱신       │
└────────────────────────────────────────────────────────────────────┘
```

> **[결정 필요 #3]** Transaction의 `paymentStatus`, `settlementId` 필드를 Core에 남길지(Core가 Portal 도메인 데이터를 보유하는 문제) vs Portal에서만 관리할지(Core와 Portal 데이터 불일치 리스크) 정책 결정 필요.
>
> **권장**: 두 필드를 Core에서 제거하고 Portal의 `charge_session_projection`과 `payment_order`에서 관리. Core는 순수 OCPP 데이터만 보유.

### 5-2. 외래키가 끊기는 케이스 처리

| 현재 FK | 분리 후 처리 | 비고 |
|---------|------------|------|
| `Settlement.partnerId → PartnerProfile.id` | 동일 DB 유지 (Portal 내부 FK) | 문제 없음 |
| `RefundLog.transactionId → Transaction.id` | Logical FK (숫자 ID 참조, DB FK 제거) | Portal이 Core의 coreTransactionId를 저장만 함 |
| `PaymentOrder.sessionId → Transaction.sessionId` | Logical 참조 (문자열 sessionId) | 현재도 FK 없음 |
| `Transaction.stationId → ChargingStation.id` | Core 내부 FK 유지 | 문제 없음 |
| `Transaction.settlementId → Settlement.id` | 제거 (Portal 투영에서 관리) | Core에서 settlementId 컬럼 삭제 권장 |
| `ChargingStation.siteId → ChargingSite.id` | Cross-DB Logical FK — siteId 숫자 참조만 유지 | Core가 단가 조회 시 Portal API 호출 또는 단가를 Core에 캐시 |

### 5-3. 트랜잭션 일관성 — 충전 종료 → 요금 계산 → 결제 차감 흐름

**현재 흐름 (단일 프로세스)**:
```
StopTransaction 수신 (Core)
  → prisma.transaction.update(costVnd, status=Stopped)   [Core DB write]
  → refundService.createFromTransaction()                 [Portal DB write 직접]
  → postChargeBillingQueue.add()                         [BullMQ enqueue]
     → postChargeBillingProcessor: PaymentOrder 생성     [Portal DB write]
```

**분리 후 Saga 패턴 (권장)**:

```
[CSMS-Core]                         [CSMS-Portal]

StopTransaction 수신
  → transaction.update(Stopped)
  → Redis Stream 발행:
     TransactionStopped {
       transactionId, sessionId,
       stationId, meterStop,
       costVnd, unitPriceVnd,
       timestamp
     }
                          ──────►   이벤트 소비
                                    → charge_session_projection 갱신
                                    → refundLog 생성 (선결제 차액)
                                    → postChargeBillingQueue 추가

실패 처리: Portal이 이벤트 소비 실패 시 Redis Stream 재시도 (at-least-once)
중복 처리: sessionId/transactionId 기반 idempotency 키로 중복 방지
```

**선택 근거 (Saga Over Two-Phase Commit)**:

| 방식 | 선택 여부 | 근거 |
|------|-----------|------|
| **Saga (이벤트 기반)** | **권장** | 두 DB가 분리되어 XA 트랜잭션 불가. at-least-once 이벤트 + idempotency 조합이 충전 시스템에 적합. 충전 세션은 최종 일관성 허용 가능 |
| **Outbox Pattern** | 보조 수단 | Core DB에 outbox 테이블 → 트랜잭션 내 이벤트 기록 → 별도 relay가 Redis Stream 발행. DB write와 이벤트 발행의 원자성 보장 |
| **Two-Phase Commit** | 미권장 | 분산 트랜잭션 코디네이터 필요, Node.js 생태계 지원 미흡, 성능 저하 |

> **[결정 필요 #4]** Outbox 패턴 도입 여부 결정 필요. Outbox 없이 Core가 Redis Stream에 직접 발행하면 `transaction.update` 성공 후 Redis 발행 실패 시 이벤트 유실 리스크 있음. Outbox를 쓰면 안전하나 구현 비용 추가.

### 5-4. 물리적/논리적 DB 분리 방식

**권장: 같은 PostgreSQL 인스턴스, 별도 스키마(Schema)**

```
PostgreSQL 인스턴스
├── schema: core     — CSMS-Core 전용 테이블
├── schema: portal   — CSMS-Portal 전용 테이블
└── schema: public   — 공유 타입/시퀀스 (최소화)
```

**이유**:
- 운영 단순성 — 단일 DB 인스턴스, 단일 백업/복구 절차
- 마이그레이션 비용 최소 — 기존 테이블을 스키마별로 이동만 하면 됨
- Cross-schema 조인 가능 (긴급 시 포털에서 Core 테이블 직접 읽기 가능 — 개발 편의성)
- 향후 별도 DB 인스턴스 분리도 가능 (스키마 경계가 명확하면 물리 분리는 쉬움)

**별도 DB 인스턴스는 Phase 5 이후 필요 시 검토** — 현재 트래픽 수준에서는 오버엔지니어링 위험.

---

## 6. 시스템 간 연동 API 세트 (Contract)

### 6-1. Portal → Core 제어 방향 (HTTP REST)

**Base URL**: `https://core-internal.pvpentech.com/api/internal/v1`  
**인증**: `Authorization: Bearer {SERVICE_TOKEN}` (HMAC-SHA256 서명 또는 고정 API Key)  
**모든 요청**: `Idempotency-Key` 헤더 권장 (변경 유발 요청에 필수)

---

#### 충전기 상태 조회

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/stations` | 충전기 목록 (페이지네이션, status/keyword 필터) |
| `GET` | `/stations/:stationId` | 충전기 상세 (커넥터 포함) |
| `GET` | `/stations/:stationId/connection` | WebSocket 연결 상태 (`isConnected: boolean`) |
| `GET` | `/stations/:stationId/connectors` | 커넥터 상태 목록 |
| `GET` | `/stations/:stationId/ocpp-messages` | OCPP 메시지 로그 |
| `GET` | `/stations/:stationId/command-results` | OCPP 명령 결과 이력 |

```json
// GET /stations/:stationId 응답 예시
{
  "stationId": "EN1000001",
  "status": "Online",
  "lastHeartbeatAt": "2026-05-21T10:00:00Z",
  "isConnected": true,
  "firmwareVersion": "v1.2.3",
  "connectors": [
    { "connectorId": 1, "status": "Available" }
  ]
}
```

---

#### 원격 제어 명령 (비동기 — OCPP 응답은 이벤트로 반환)

| 메서드 | 경로 | OCPP Action | 동기/비동기 |
|--------|------|-------------|------------|
| `POST` | `/stations/:stationId/commands/reset` | Reset | 비동기 |
| `POST` | `/stations/:stationId/commands/change-availability` | ChangeAvailability | 비동기 |
| `POST` | `/stations/:stationId/commands/change-configuration` | ChangeConfiguration | 비동기 |
| `POST` | `/stations/:stationId/commands/get-configuration` | GetConfiguration | 비동기 |
| `POST` | `/stations/:stationId/commands/clear-cache` | ClearCache | 비동기 |
| `POST` | `/stations/:stationId/commands/unlock-connector` | UnlockConnector | 비동기 |
| `POST` | `/stations/:stationId/commands/trigger-message` | TriggerMessage | 비동기 |
| `POST` | `/stations/:stationId/commands/data-transfer` | DataTransfer | 비동기 |

```json
// POST /stations/:stationId/commands/reset 요청
{
  "type": "Soft"
}

// 응답 (202 Accepted — 명령 발신 완료, OCPP 응답은 이벤트로 전달)
{
  "messageId": "uuid-v4",
  "action": "Reset",
  "status": "sent",
  "sentAt": "2026-05-21T10:00:00Z"
}

// 오류 응답
{
  "error": { "code": "STATION_OFFLINE", "message": "Station is offline" }
}
```

---

#### 충전 세션 제어 (동기 — OCPP 응답 대기 후 반환)

| 메서드 | 경로 | OCPP Action | 동기/비동기 | Idempotency-Key |
|--------|------|-------------|------------|-----------------|
| `POST` | `/sessions/start` | RemoteStartTransaction | 동기 (30s timeout) | 필수 |
| `POST` | `/sessions/:sessionId/stop` | RemoteStopTransaction | 동기 (30s timeout) | 필수 |

```json
// POST /sessions/start 요청
{
  "stationId": "EN1000001",
  "connectorId": 1,
  "idTag": "SESSION-ABCD1234",
  "idempotencyKey": "charge-req-{userId}-{timestamp}"
}

// 응답 (200 OK — OCPP RemoteStartTransaction.conf 결과)
{
  "status": "Accepted",   // or "Rejected"
  "transactionId": null,  // StartTransaction 이후 이벤트로 전달
  "messageId": "uuid-v4"
}
```

---

#### 펌웨어 관리

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/firmware/upload` | 펌웨어 파일 업로드 (multipart/form-data) |
| `GET` | `/firmware` | 펌웨어 목록 |
| `POST` | `/firmware/campaigns` | 펌웨어 캠페인 시작 |
| `GET` | `/firmware/campaigns/:id` | 캠페인 진행 상황 |
| `DELETE` | `/firmware/campaigns/:id` | 캠페인 취소 |
| `POST` | `/stations/:stationId/firmware/update` | 단일 충전기 펌웨어 업데이트 |

---

#### 진단 및 설정

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/stations/:stationId/diagnostics` | GetDiagnostics 명령 발신 |
| `GET` | `/stations/:stationId/diagnostics` | 진단 요청 이력 |
| `GET` | `/stations/:stationId/config` | ChargerConfig 조회 |
| `PUT` | `/stations/:stationId/config/:key` | ChargerConfig 값 갱신 |

---

#### 프로비저닝 관리 (Portal → Core 포함)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/provisioning` | 프로비저닝 목록 |
| `POST` | `/provisioning` | 사전 등록 (CS 담당자) |
| `PUT` | `/provisioning/:id/reject` | 거부 |
| `GET` | `/manufacturers` | 제조사 목록 |
| `POST` | `/manufacturers` | 제조사 등록 |

---

#### 에러 코드 표준

| 코드 | HTTP | 설명 |
|------|------|------|
| `STATION_OFFLINE` | 422 | 충전기 오프라인 |
| `STATION_NOT_FOUND` | 404 | 충전기 미존재 |
| `OCPP_TIMEOUT` | 504 | OCPP 응답 타임아웃 |
| `OCPP_REJECTED` | 422 | 충전기가 명령 거부 |
| `DUPLICATE_REQUEST` | 409 | 동일 Idempotency-Key 중복 |
| `UNAUTHORIZED` | 401 | 서비스 토큰 인증 실패 |

---

### 6-2. Core → Portal 이벤트 방향

#### 옵션 비교

| 방식 | 장점 | 단점 | 권장 여부 |
|------|------|------|-----------|
| **(A) Webhook (HTTP POST)** | 구현 단순, Portal이 수신 엔드포인트만 구현 | Core가 Portal 주소를 알아야 함, 순서 보장 어려움, Core가 재시도 책임 | 소규모에 적합, 초기 단계 |
| **(B) Redis Stream** | 현재 Redis 이미 사용 중, 추가 인프라 없음, Consumer Group으로 at-least-once 보장, 순서 보장 (단일 키 내) | Kafka 대비 보존 기간 제한, 클러스터링 시 샤딩 복잡성 | **권장** — 현재 규모에 최적 |
| **(C) RabbitMQ** | 메시지 라우팅 유연, 신뢰성 높음 | 새 인프라 추가 필요, 운영 부담 | 중대형 규모에 적합 |
| **(D) Kafka** | 높은 처리량, 장기 보존, 이벤트 소싱 | 운영 복잡도 높음, 현재 규모 오버스펙 | 대규모 시 고려 |
| **(E) gRPC streaming** | 낮은 레이턴시, 강타입 | 복잡한 구현, 연결 상태 관리 필요 | 미권장 |

> **권장: Redis Stream (옵션 B).** 이미 BullMQ용 Redis가 운영 중이므로 추가 인프라 없이 도입 가능. 이벤트 소비 실패 시 Consumer Group을 통한 재처리 보장.

---

#### 이벤트 카탈로그 (Redis Stream Key: `csms:core:events`)

**StationOnline**
```json
{
  "eventId": "uuid-v4",
  "eventType": "StationOnline",
  "occurredAt": "2026-05-21T10:00:00Z",
  "stationId": "EN1000001",
  "payload": {
    "chargePointVendor": "VendorA",
    "chargePointModel": "Model-7kW",
    "firmwareVersion": "v1.2.3"
  }
}
```

**StationOffline**
```json
{
  "eventId": "uuid-v4",
  "eventType": "StationOffline",
  "occurredAt": "2026-05-21T10:05:00Z",
  "stationId": "EN1000001",
  "payload": { "reason": "CommunicationFault" }
}
```

**TransactionStarted**
```json
{
  "eventId": "uuid-v4",
  "eventType": "TransactionStarted",
  "occurredAt": "2026-05-21T10:10:00Z",
  "stationId": "EN1000001",
  "payload": {
    "transactionId": 1234,
    "sessionId": "SESSION-ABCD1234",
    "connectorId": 1,
    "idTag": "SESSION-ABCD1234",
    "meterStart": 0,
    "unitPriceVnd": 3500,
    "marginRate": "10.00",
    "settlementSchedule": "monthly",
    "settlementDay": 25
  }
}
```

**TransactionStopped**
```json
{
  "eventId": "uuid-v4",
  "eventType": "TransactionStopped",
  "occurredAt": "2026-05-21T11:00:00Z",
  "stationId": "EN1000001",
  "payload": {
    "transactionId": 1234,
    "sessionId": "SESSION-ABCD1234",
    "meterStart": 0,
    "meterStop": 7200,
    "totalKwh": 7.2,
    "costVnd": 25200,
    "unitPriceVnd": 3500,
    "timeStart": "2026-05-21T10:10:00Z",
    "timeEnd": "2026-05-21T11:00:00Z",
    "reason": "Remote"
  }
}
```

**MeterValueUpdate**
```json
{
  "eventId": "uuid-v4",
  "eventType": "MeterValueUpdate",
  "occurredAt": "2026-05-21T10:30:00Z",
  "stationId": "EN1000001",
  "payload": {
    "transactionId": 1234,
    "sessionId": "SESSION-ABCD1234",
    "currentKwh": 3.5,
    "currentW": 7000
  }
}
```

**ConnectorStatusChanged**
```json
{
  "eventId": "uuid-v4",
  "eventType": "ConnectorStatusChanged",
  "occurredAt": "2026-05-21T10:00:00Z",
  "stationId": "EN1000001",
  "payload": {
    "connectorId": 1,
    "status": "Charging",
    "errorCode": "NoError"
  }
}
```

**FaultRaised / FaultCleared**
```json
{
  "eventId": "uuid-v4",
  "eventType": "FaultRaised",
  "stationId": "EN1000001",
  "payload": {
    "connectorId": 1,
    "errorCode": "GroundFailure",
    "info": "Ground fault detected"
  }
}
```

**FirmwareStatusChanged**
```json
{
  "eventId": "uuid-v4",
  "eventType": "FirmwareStatusChanged",
  "stationId": "EN1000001",
  "payload": {
    "status": "Installed",
    "campaignId": 5,
    "firmwareVersion": "v2.0.0"
  }
}
```

**OcppCommandResultReceived**
```json
{
  "eventId": "uuid-v4",
  "eventType": "OcppCommandResultReceived",
  "stationId": "EN1000001",
  "payload": {
    "messageId": "uuid-v4",
    "action": "Reset",
    "status": "completed",
    "responsePayload": { "status": "Accepted" }
  }
}
```

---

#### 이벤트 재전송 정책 및 중복 처리

| 항목 | 정책 |
|------|------|
| **전달 보장** | at-least-once (Redis Stream Consumer Group) |
| **중복 처리** | Portal은 `eventId` 기반 idempotency 체크 |
| **순서 보장** | 단일 stationId 내 순서 보장 (Redis Stream 단일 키) |
| **재시도** | Consumer Group PEL(Pending Entries List) 기반 자동 재처리 |
| **보존 기간** | Redis Stream maxlen 설정 (권장: 최근 100만 건 또는 7일) |
| **Dead Letter** | N회 재처리 실패 시 별도 `csms:core:events:dlq` 스트림으로 이동 |

---

### 6-3. 인증/보안

| 항목 | 방식 |
|------|------|
| **Portal → Core HTTP** | `Authorization: Bearer {SERVICE_TOKEN}`. 토큰은 환경변수로 주입 (양 시스템 공유 비밀). 대안: HMAC-SHA256 서명 (Timestamp + Payload 서명으로 재사용 방지) |
| **네트워크 격리** | Core의 `/api/internal/v1` 경로는 인터넷 노출 금지. VPC 내부 또는 프라이빗 서브넷에서만 접근. nginx에서 internal 경로에 대해 `allow 10.0.0.0/8; deny all;` 적용 |
| **Redis Stream** | Redis AUTH + TLS 연결 (인프라 레벨) |
| **충전기 WebSocket** | OCPP Basic Auth (stationId + passwordHash, bcrypt 검증) — 현재 구현 그대로 유지 |

---

## 7. 분리 전/후 배포 아키텍처

### 7-1. 현재 아키텍처 (단일 프로세스)

```
┌────────────────────────────────────────────────────────┐
│                   Internet / EV Chargers               │
└───────────┬─────────────────────────┬──────────────────┘
            │ HTTPS/WSS               │ HTTPS (App/Portal)
            ▼                         ▼
┌───────────────────────────────────────────────────────┐
│                  nginx (Reverse Proxy)                 │
│  /ocpp/*  → ws://localhost:3000                        │
│  /api/*   → http://localhost:3000                      │
│  /portal/* → http://localhost:3000                     │
└────────────────────┬──────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────┐
│         Node.js CSMS Server (단일 프로세스, port 3000)   │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Express.js (REST) + ws (WebSocket OCPP)           │ │
│  │  OCPP Handlers │ Portal API │ Mobile API │ Jobs     │ │
│  └─────────────────────────┬──────────────────────────┘ │
└────────────────────────────┼───────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
┌─────────────────────┐     ┌──────────────────────────┐
│  PostgreSQL          │     │  Redis                   │
│  (단일 DB, 단일 schema)│     │  (BullMQ + PnC 캐시)     │
└─────────────────────┘     └──────────────────────────┘
```

### 7-2. 분리 후 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                   Internet / EV Chargers / Apps / Browsers      │
└────────────┬──────────────────────────────┬─────────────────────┘
             │ WSS (충전기)                  │ HTTPS (앱/포털)
             ▼                              ▼
┌────────────────────────┐  ┌────────────────────────────────────┐
│  nginx/LoadBalancer    │  │  nginx/LoadBalancer                │
│  (Core 전용)            │  │  (Portal 전용)                     │
│  wss://chargers.cp.kr  │  │  https://api.cp.kr                 │
└──────────┬─────────────┘  └──────────────┬─────────────────────┘
           │                               │
           ▼                               ▼
┌──────────────────────┐   ┌──────────────────────────────────────┐
│  CSMS-Core           │   │  CSMS-Portal                         │
│  (port 3001)         │   │  (port 3002)                         │
│                      │   │                                      │
│  - OCPP WS Server    │   │  - REST API (Mobile App)             │
│  - Provisioning      │◄──│  - Portal API (CS/Partner/Customer)  │
│  - Firmware          │   │  - Payment / Settlement / Refund     │
│  - Station Mgmt      │   │  - Auth / User / i18n                │
│  - OCPP Commands     │   │  - Jobs (Billing/Refund/Settlement)  │
│  - Jobs (OCPP/FW)    │   │                                      │
└──────────┬───────────┘   └──────────────┬───────────────────────┘
           │                              │
           │  ┌───────────────────────────┘
           │  │  Redis Stream (이벤트 발행/소비)
           │  │  Portal → Core: HTTP REST (Internal API)
           │  ▼
┌──────────────────────────────────────────────────────────────┐
│   PostgreSQL (같은 인스턴스, 별도 schema)                      │
│   schema: core    │  schema: portal                           │
│   (충전기/OCPP)   │  (비즈니스/결제/정산)                      │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐
│  Redis               │
│  (Core BullMQ)       │
│  (Portal BullMQ)     │
│  (Redis Stream)      │
└──────────────────────┘
```

### 7-3. 인프라 구성 권장

| 컴포넌트 | Core | Portal | 공유 |
|----------|------|--------|------|
| **Compute** | 2 vCPU / 4GB RAM (충전기 수에 따라 확장) | 2 vCPU / 4GB RAM | - |
| **DB** | PostgreSQL 14+ (schema: core) | (동일 인스턴스 schema: portal) | 동일 인스턴스 권장 |
| **Redis** | 공유 인스턴스 또는 별도 | 공유 인스턴스 또는 별도 | 공유 권장 (비용) |
| **Reverse Proxy** | nginx (WSS 종료 + Internal Only) | nginx (HTTPS 종료) | - |
| **모니터링** | Pino → ELK/CloudWatch | Pino → ELK/CloudWatch | 분산 트레이싱: Jaeger/OTEL |
| **스토리지** | 펌웨어 파일 (로컬 또는 S3) | - | - |

### 7-4. 환경 분리 (dev/staging/prod) 버전 매트릭스 관리

```
버전 매트릭스 예시:
┌──────────┬──────────────┬───────────────┬─────────────────────────┐
│  환경     │  Core 버전   │  Portal 버전  │  비고                   │
├──────────┼──────────────┼───────────────┼─────────────────────────┤
│  dev      │  main        │  main         │  항상 최신 브랜치        │
│  staging  │  v1.5.0      │  v2.1.0       │  통합 테스트 환경        │
│  prod     │  v1.4.2      │  v2.0.1       │  독립 배포 가능          │
└──────────┴──────────────┴───────────────┴─────────────────────────┘

API Contract 버전: /api/internal/v1 — 하위 호환 보장.
Breaking change 시 /v2 추가 후 Core/Portal 동시 업그레이드 기간 설정.
```

---

## 8. Repository 분리 전략

### 8-1. 새 리포지터리 명명 권장

| 시스템 | 권장 이름 | 이유 |
|--------|-----------|------|
| CSMS-Core | `pvpentech-csms-core` | 역할 명확, 도메인 포함 |
| CSMS-Portal | `pvpentech-csms-portal` | 역할 명확, 도메인 포함 |
| (선택) 공유 타입 | `pvpentech-csms-shared` | 공통 타입/스키마 패키지 |

### 8-2. 공통 코드 처리 방법

공통이 될 코드: TypeScript 타입 정의 (OCPP 액션 타입, 이벤트 스키마, API 응답 타입), 공통 에러 코드, 환경 검증 스키마(일부)

| 방식 | 장점 | 단점 | 권장 |
|------|------|------|------|
| **npm package** (`pvpentech-csms-shared`) | 타입 안전, 명시적 버전 관리, 두 시스템이 독립적으로 업그레이드 가능 | 패키지 관리 오버헤드, private npm registry 필요 (또는 GitHub Packages) | **권장 (중기)** |
| **단순 복사** | 초기 분리 시 빠름 | 동기화 부담, 타입 불일치 위험 | **단기 (Phase 3~4)** |
| **git submodule** | 버전 추적 가능 | 복잡한 워크플로우, 개발 경험 나쁨 | 미권장 |
| **monorepo (turborepo/nx)** | 단일 리포에서 packages/* 분리, 공통 코드 자연스럽게 공유 | 현재 단일 리포 → 변환 비용, 배포 파이프라인 재설계 | 장기 고려 |

> **Phase 3~4**: 단순 복사로 시작, **Phase 5 이후**: `pvpentech-csms-shared` npm package 추출.

### 8-3. 현재 모노리포 → 새 리포 마이그레이션 절차

**히스토리 보존 방식 (git filter-repo 활용)**:

```bash
# CSMS-Core 리포 생성
git clone --no-local https://github.com/org/pvpentech pvpentech-csms-core
cd pvpentech-csms-core
pip install git-filter-repo
git filter-repo --path src/ocpp/ \
                --path src/services/station.service.ts \
                --path src/services/firmware.service.ts \
                --path src/services/provision.service.ts \
                --path src/repositories/station.repository.ts \
                --path prisma/schema.prisma \
                # ... Core 관련 파일 목록
```

> **히스토리 보존 권장** — 버그 추적, 코드 변경 이력 유지에 필수. `git filter-repo`는 `git filter-branch` 대비 빠르고 안전.

**절차 요약**:
1. 현재 리포 보존 (아카이브 목적으로 유지)
2. `git filter-repo`로 각 시스템에 해당하는 파일만 추출하여 새 리포 생성
3. 새 리포에서 공통 코드 정리 및 불필요한 파일 제거
4. CI/CD 파이프라인 별도 구성

### 8-4. CI/CD 영향

| 항목 | Core | Portal |
|------|------|--------|
| **빌드 트리거** | `pvpentech-csms-core` push/PR | `pvpentech-csms-portal` push/PR |
| **단위 테스트** | OCPP 핸들러, 명령 빌더, connectionManager | 서비스 비즈니스 로직, 결제 플로우 |
| **통합 테스트** | Core-only: WebSocket 연결, OCPP 메시지 흐름 | Portal-only: REST API, DB 쿼리 |
| **E2E 테스트** | **별도 통합 테스트 리포 권장** — 두 시스템을 docker-compose로 기동 후 시나리오 테스트 |
| **배포** | Core 단독 배포 (OCPP 연결 유지 — Zero-downtime: graceful websocket drain) | Portal 단독 배포 (일반 rolling update) |

> **Zero-downtime Core 배포**: WebSocket은 재시작 시 연결이 끊어짐. `pm2 reload`(graceful restart) 또는 nginx upstream 교체 방식으로 재연결 시간 최소화 필요. 향후 멀티 인스턴스 + stationId sticky routing 구현 시 무중단 배포 가능.

---

## 9. 마이그레이션 로드맵

### Phase 0: 사전 정리 (선행 조건)

**목표**: 코드 분리 전 경계 명확화 및 기술 부채 제거

| Task | 작업 내용 | 산출물 | 위험 | 롤백 | 예상 기간 |
|------|-----------|--------|------|------|-----------|
| 0-1 | ISO 15118 PnC 코드 일체 제거 (핸들러 4개 + 서비스 7개 + 스케줄러 + 유틸) | PnC 없는 코드베이스 | `DataTransfer` 핸들러 레지스트리가 PnC에 의존하는 부분 주의 | git revert | 2-3일 |
| 0-2 | PnC DB 모델 3개 삭제 마이그레이션 (`PncInstalledCertificate`, `PncCsrInProgress`, `PncAuditLog`) | Prisma 마이그레이션 파일 | 데이터 삭제 불가역 — 운영 데이터 백업 필수 | 백업 복원 | 1일 |
| 0-3 | 환경변수 `PKI_*`, `OCSP_*`, `PNC_*` 정리 | `env.ts` 업데이트 | 기존 `.env` 파일에서 제거 필요 | 없음 | 0.5일 |
| 0-4 | `charge.service.ts`의 `@ocpp/commands` 직접 import를 인터페이스(추상 클래스) 뒤로 숨기기 | `IOcppGateway` 인터페이스 정의 | 기능 변경 없음 | git revert | 1-2일 |
| 0-5 | `stopTransaction.handler.ts`의 `refundService`, `postChargeBillingQueue` 의존 분석 및 이벤트 설계 | 이벤트 스키마 문서 | - | - | 1일 |
| 0-6 | Prisma schema를 `core`/`portal` 논리 그룹으로 주석 정리, 양쪽 필요 엔티티 명시 | 주석 업데이트된 schema.prisma | - | - | 0.5일 |
| **합계** | | | | | **6-8일** |

---

### Phase 1: 모노리포 내 모듈 분리

**목표**: 같은 리포 안에서 `/packages/core`, `/packages/portal`로 디렉토리/패키지 분리. 인터페이스만 먼저 분리 — 아직 단일 프로세스.

```
pvpentech/
├── packages/
│   ├── core/          ← OCPP 게이트웨이
│   │   ├── src/
│   │   │   ├── ocpp/
│   │   │   ├── services/ (station, firmware, provision ...)
│   │   │   └── internal-api/    ← Core → Portal 이벤트 발행 모듈
│   │   └── package.json
│   ├── portal/        ← 비즈니스 포털
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── services/ (charge, payment, settlement ...)
│   │   │   └── core-client/     ← Portal → Core HTTP 클라이언트 모듈
│   │   └── package.json
│   └── shared/        ← 공통 타입
│       ├── types/     ← OCPP 타입, 이벤트 스키마
│       └── package.json
├── apps/
│   └── server/        ← 단일 프로세스 진입점 (두 패키지 조합)
└── package.json       ← workspace 루트
```

| Task | 작업 내용 | 산출물 | 예상 기간 |
|------|-----------|--------|-----------|
| 1-1 | npm workspace / turborepo 설정 | package.json workspace 구성 | 1일 |
| 1-2 | Core 패키지로 파일 이동 (ocpp/*, 관련 서비스/리포지터리) | packages/core 구조 | 2-3일 |
| 1-3 | Portal 패키지로 파일 이동 | packages/portal 구조 | 2-3일 |
| 1-4 | 교차 의존 (`charge.service → ocpp/commands`) 를 `IOcppGateway` 인터페이스 경유로 치환 | 인터페이스 분리 완료 | 2일 |
| 1-5 | 단일 프로세스 진입점(`apps/server`)에서 두 패키지 조합하여 기존 기능 그대로 동작 확인 | 기존 테스트 통과 | 1일 |
| **합계** | | | **8-10일** |

**위험**: import 경로 대규모 변경 — TypeScript path alias 재구성 필요  
**롤백**: 가능 (git revert, 파일 이동은 reversible)

---

### Phase 2: 연동 API 추출

**목표**: 직접 import 호출을 HTTP 호출로 치환. 이 단계에서도 단일 프로세스로 실행 가능(HTTP를 localhost로).

| Task | 작업 내용 | 산출물 | 예상 기간 |
|------|-----------|--------|-----------|
| 2-1 | CSMS-Core Internal API 서버 구현 (`/api/internal/v1/*`) | Core REST API 완성 | 3-4일 |
| 2-2 | CSMS-Portal의 Core API 클라이언트 구현 (`CoreApiClient`) | HTTP 클라이언트 모듈 | 2일 |
| 2-3 | `charge.service.ts`의 `sendRemoteStartTransaction` 직접 호출 → `CoreApiClient.startSession()` 치환 | 충전 시작 API 연동 | 1일 |
| 2-4 | `stopTransaction.handler.ts`의 refund/billing 직접 호출 → Redis Stream 이벤트 발행으로 치환 | 이벤트 발행 모듈 구현 | 2-3일 |
| 2-5 | Portal의 Redis Stream Consumer 구현 (`TransactionStopped` 이벤트 소비 → refund/billing 처리) | 이벤트 소비 모듈 | 2-3일 |
| 2-6 | 단일 프로세스에서 두 서버(Core:3001, Portal:3002)를 동시 기동하여 기존 기능 검증 | 통합 테스트 통과 | 1일 |
| **합계** | | | **11-13일** |

**위험**: `TransactionStopped` 이벤트 유실 시 환불/결제 누락. Outbox 패턴 도입 여부 결정 필요.  
**롤백**: 가능 — 직접 import 버전을 feature flag로 유지

---

### Phase 3: DB 논리적 분리

**목표**: 단일 스키마를 `core` / `portal` 두 스키마로 분리. 교차 참조 제거.

| Task | 작업 내용 | 산출물 | 예상 기간 |
|------|-----------|--------|-----------|
| 3-1 | Prisma 스키마를 두 파일로 분리 (`schema-core.prisma`, `schema-portal.prisma`) | 분리된 스키마 파일 | 1-2일 |
| 3-2 | PostgreSQL에 `core` schema 생성, 테이블 이전 (ALTER TABLE SET SCHEMA) | DB 스키마 분리 완료 | 1일 |
| 3-3 | `Transaction`의 `paymentStatus`, `settlementId` 필드를 Portal 쪽으로 이동, `charge_session_projection` 테이블 생성 | DB 마이그레이션 | 2-3일 |
| 3-4 | Prisma client 두 개 분리 (`prismaCore`, `prismaPortal`), 각 패키지에서 해당 client만 사용 | Prisma 클라이언트 분리 | 1일 |
| 3-5 | 교차 DB 조인 모두 API 호출로 대체 확인 (cross-schema 직접 SELECT 없음) | 코드 감사 완료 | 1일 |
| **합계** | | | **6-7일** |

**위험**: 기존 쿼리 중 교차 조인이 있다면 all → API 호출로 대체 작업 추가  
**롤백**: 스키마 롤백 가능하나, 데이터 이동 후 롤백은 복잡 → 스테이징에서 충분히 검증 필요

---

### Phase 4: 리포 분리 및 독립 배포

**목표**: 두 리포를 별도로 생성, 각자 독립 배포 파이프라인 구성

| Task | 작업 내용 | 산출물 | 예상 기간 |
|------|-----------|--------|-----------|
| 4-1 | `git filter-repo`로 Core 파일 추출 → `pvpentech-csms-core` 리포 생성 | 새 리포 + 히스토리 | 1일 |
| 4-2 | `git filter-repo`로 Portal 파일 추출 → `pvpentech-csms-portal` 리포 생성 | 새 리포 + 히스토리 | 1일 |
| 4-3 | 각 리포 CI/CD 파이프라인 구성 (GitHub Actions) | 자동 테스트/빌드 | 2일 |
| 4-4 | 스테이징 환경에서 두 시스템 독립 배포 및 연동 테스트 | 스테이징 검증 완료 | 3일 |
| 4-5 | 프로덕션 컷오버 (Core 먼저 배포, Portal 이후 — 기존 단일 프로세스 shutdown → 두 프로세스 startup) | 프로덕션 전환 | 1일 |
| **합계** | | | **8일** |

**위험**: 프로덕션 컷오버 시 충전기 재연결 다운타임 발생 가능  
**롤백**: 기존 단일 프로세스 서버를 즉시 재기동 (pm2 start 기존 ecosystem)

---

### Phase 5: 모니터링/롤백 절차 정착

| Task | 작업 내용 | 예상 기간 |
|------|-----------|-----------|
| 5-1 | 분산 트레이싱 도입 (OpenTelemetry — Core와 Portal의 트레이스 연결) | 3-5일 |
| 5-2 | 통합 로그 집계 (ELK 또는 CloudWatch — 두 시스템 로그 한 곳에서 조회) | 2일 |
| 5-3 | Redis Stream 소비 지연/DLQ 모니터링 알람 | 1일 |
| 5-4 | 운영 Runbook 작성 (Core 배포 절차, Zero-downtime 전략, 롤백 절차) | 2일 |
| 5-5 | 버전 매트릭스 관리 문서 및 API Contract 변경 절차 | 1일 |
| **합계** | | **9-11일** |

---

### 전체 로드맵 타임라인 요약

```
Week 1-2:  Phase 0 (PnC 제거 + 경계 정리)
Week 3-4:  Phase 1 (모노리포 내 패키지 분리)
Week 5-7:  Phase 2 (연동 API 추출 + 이벤트 발행)
Week 8-9:  Phase 3 (DB 논리 분리)
Week 10-11: Phase 4 (리포 분리 + 독립 배포)
Week 12-13: Phase 5 (모니터링 + 운영 안정화)

총 예상: 12-13주 (약 3개월, 1인 기준 인일 약 45-55일)
팀 2인 병렬 작업 시: 약 7-8주
```

---

## 10. 리스크와 대안

### 10-1. 주요 리스크 및 회피책

**리스크 1: 분산 모놀리스 (Distributed Monolith)**

> 경계를 잘못 그으면 두 서비스가 서로를 과도하게 호출하여, 마이크로서비스의 복잡도는 얻고 모놀리스의 단순성은 잃는 최악의 상태.

| 회피책 |
|--------|
| 인터페이스를 최소화: Portal → Core 동기 HTTP 호출은 충전기 상태 조회와 RemoteStart/Stop에만 한정 |
| 나머지 통신은 이벤트(비동기). 이벤트를 소비해 자체 투영을 유지하면 실시간 API 의존 감소 |
| "API 호출 수 > N회/요청"이면 경계 재검토 신호 |

**리스크 2: 트랜잭션 일관성 약화**

> `StopTransaction` → `costVnd 계산` → `환불 생성` → `결제 차감`이 현재 단일 DB 트랜잭션 내에서 처리되지 않더라도 같은 프로세스 내 동기 흐름. 분리 후 이 흐름은 이벤트 기반으로 바뀌어 최종 일관성(Eventual Consistency)만 보장.

| 회피책 |
|--------|
| Outbox 패턴: Core DB에 outbox 테이블 추가. `transaction.update`와 `outbox.insert`를 단일 DB 트랜잭션으로 처리. relay가 outbox를 읽어 Redis Stream 발행 |
| idempotency: 모든 이벤트에 `eventId` 포함, Portal이 중복 소비 방지 |
| 환불/결제 실패는 배치 재시도로 복구 (현재도 배치 기반) — 즉각 일관성 불필요 |

**리스크 3: 운영 복잡도 증가**

| 영역 | 리스크 | 완화 |
|------|--------|------|
| 배포 | Core 배포 시 WebSocket 재연결 | Graceful drain + pm2 cluster |
| 로그 | 두 시스템 로그 분산 | 통합 로그 집계 (ELK/CloudWatch) |
| 디버깅 | 이벤트 추적이 어려움 | OpenTelemetry trace ID 전파 |
| 버전 | API Contract 불일치 | 시맨틱 버전 + Breaking change 절차 |

**리스크 4: connectionManager in-process 메모리 한계**

> 현재 `connectionManager`는 `Map<string, WebSocket>`으로 in-process. CSMS-Core 멀티 인스턴스 배포 시 A 인스턴스에 연결된 충전기 명령을 B 인스턴스가 발신 불가.

| 완화 방안 |
|-----------|
| 단기: nginx sticky session (X-Forwarded-For 또는 `stationId` 기반 upstream hash) |
| 중기: Redis 기반 stationId → 인스턴스 라우팅 레이어. 명령 발신은 Redis pub/sub으로 해당 인스턴스에 포워딩 |

---

### 10-2. 대안 평가 — 분리하지 않는 경우

**모듈러 모놀리스 유지 + 명확한 내부 인터페이스**

단일 리포, 단일 프로세스를 유지하되 내부 모듈 경계를 엄격히 강제:

```
장점:
- 트랜잭션 일관성 유지 (단일 DB 트랜잭션)
- 운영 단순성 (단일 배포, 단일 로그, 단일 모니터링)
- 현재 팀 규모(소규모)에 적합
- 리팩토링 비용 최소

단점:
- OCPP 게이트웨이와 비즈니스 로직 배포가 함께 묶임
- 코드 경계 강제 수단이 lint/review뿐
- 스케일링 한계 (충전기 수 급증 시 전체 스케일 업 필요)
```

**모듈러 모놀리스 방식의 구체적 대안**:

1. Phase 0 (PnC 제거) + Phase 1 (패키지 분리)만 진행
2. `packages/core`와 `packages/portal`의 교차 import를 ESLint 규칙으로 금지
3. `IOcppGateway` 인터페이스를 통해서만 Core 기능 접근
4. 단일 프로세스, 단일 DB, 단일 리포 유지

이 방식은 **2-3주** 작업으로 경계를 명확히 하면서 배포 복잡도를 추가하지 않는다. 향후 시스템이 커지면 Phase 2 이후를 진행할 수 있다.

---

### 10-3. 권장 결정

> **권장: 모듈러 모놀리스 우선 + 점진적 분리 검토**

현재 코드베이스 규모(~30개 서비스, ~15개 라우트 그룹, 단일 DB)와 팀 규모를 고려할 때:

1. **즉시**: Phase 0 (PnC 제거) 진행 — 요구사항이 명확하고 비용 낮음
2. **단기(1-2개월)**: Phase 1 (모노리포 내 패키지 분리) + IOcppGateway 인터페이스 정의 — 코드 경계 명확화
3. **중기(3-6개월)**: 충전기 수 증가 또는 팀 확장 시 Phase 2~4 진행 여부 재평가
4. **분리 트리거**: (a) 동시 접속 충전기 수 > 500대, (b) Core/Portal 팀이 독립적으로 운영, (c) OCPP 적합성 테스트(OCTT) 별도 환경 필요

---

## 11. 결론 및 즉시 실행 가능한 다음 단계

### 11-1. 사용자(프로젝트 오너)가 의사결정해야 하는 항목

| # | 결정 항목 | 선택지 | 영향 |
|---|-----------|--------|------|
| **D-1** | `Transaction` 모델의 `paymentStatus`, `settlementId` 필드를 Core DB에 남길지 Portal로 이전할지 | A) Core 유지 (결합 허용) / B) Portal 이전 (투영 테이블 도입) | DB 분리 아키텍처 전체에 영향 |
| **D-2** | CSMS-Core 멀티 인스턴스 운영 계획 여부 | A) 단일 인스턴스 유지 / B) 멀티 인스턴스 (Redis 라우팅 필요) | connectionManager 리팩토링 필요 여부 |
| **D-3** | `TransactionStopped` 이벤트 유실 방지를 위한 Outbox 패턴 도입 여부 | A) Outbox 도입 (안전, 구현 비용 +3일) / B) 직접 발행 (간단, 유실 리스크 소) | Phase 2 구현 방식 결정 |
| **D-4** | Core→Portal 이벤트 전달 방식 | A) Redis Stream / B) Webhook / C) RabbitMQ | 인프라 추가 여부 |
| **D-5** | 분리 진행 범위 | A) Phase 0+1만 (모듈러 모놀리스) / B) Phase 0~4 (완전 분리) | 전체 공수 및 타임라인 |

### 11-2. Phase 0 즉시 착수 가능한 첫 작업 (우선순위 순)

1. **[P0-T1] PnC 서비스 등록 제거** (0.5일)
   - `src/server.ts`에서 `registerPncHandlers()`, `startPncCertExpiryScheduler()`, `logPncConfigOnce()` 3줄 제거
   - `src/ocpp/handlers/pnc/` 디렉토리 삭제
   - `src/ocpp/commands/pncSend.command.ts` 삭제

2. **[P0-T2] PnC 서비스 파일 삭제** (1일)
   - `src/services/pncPki.service.ts`, `pncOcsp.service.ts`, `pncAuditLog.service.ts`, `pncConfig.service.ts`, `pncCertExpiry.service.ts` 삭제
   - `src/utils/ocspRequest.ts`, `src/utils/asn1.ts` 삭제
   - `src/config/pnc.ts` 삭제
   - `src/jobs/schedulers/pncCertExpiry.scheduler.ts` 삭제

3. **[P0-T3] PnC 라우트 제거** (0.5일)
   - `src/routes/portal/cs/pncOps.routes.ts` 삭제 및 `routes/index.ts`에서 import 제거

4. **[P0-T4] PnC DB 마이그레이션** (1일)
   - `prisma/schema.prisma`에서 `PncInstalledCertificate`, `PncCsrInProgress`, `PncAuditLog` 모델 삭제
   - `npx prisma migrate dev --name remove_pnc_models` 실행
   - **주의**: 운영 환경 실행 전 데이터 백업 필수

5. **[P0-T5] 환경변수 정리** (0.5일)
   - `src/config/env.ts`에서 `PKI_BASE_URL`, `OCSP_BASE_URL`, `PKI_API_ID`, `PKI_API_KEY`, `PNC_ENABLED_DEFAULT`, `PNC_TRIGGER_RENEWAL_DAYS`, `PNC_PKI_TIMEOUT_MS`, `PNC_OCSP_TIMEOUT_MS` 제거

6. **[P0-T6] IOcppGateway 인터페이스 정의** (1-2일)
   - `src/ocpp/gateway.interface.ts` 파일 생성
   - `ChargeService`가 사용하는 `sendRemoteStartTransaction`, `sendRemoteStopTransaction` 시그니처를 인터페이스로 추상화
   - 구현체: `OcppGatewayImpl` (현재 직접 호출 유지), 향후 `CoreApiGatewayImpl`로 교체

### 11-3. 사전에 결정이 필요한 외부 의존

| 항목 | 이유 | 결정 기한 |
|------|------|-----------|
| **Redis Stream 사용 여부** (vs Webhook) | Phase 2 구현 방식 결정 | Phase 2 착수 전 |
| **PostgreSQL 스키마 분리 방식** (동일 인스턴스 vs 별도 인스턴스) | Phase 3 구현 방식 | Phase 3 착수 전 |
| **서비스 토큰 관리 방식** (정적 API Key vs HMAC) | Core Internal API 인증 구현 | Phase 2 착수 전 |
| **충전기 재연결 허용 다운타임** | Core 배포 전략 (Zero-downtime vs 짧은 중단 허용) | Phase 4 착수 전 |
| **PnC 데이터 보존 여부** (운영 중 PnC 데이터 있다면 백업 후 삭제 vs 다른 테이블로 아카이브) | Phase 0 시작 전 | **즉시** |

---

## 부록: 핵심 결합 지점 코드 위치 요약

분리 작업 시 반드시 수정해야 하는 직접 의존 관계:

| 위치 | 현재 의존 | 분리 후 대체 |
|------|-----------|------------|
| `src/services/charge.service.ts:4` | `import { sendRemoteStartTransaction } from '@ocpp/commands/...'` | `IOcppGateway.startSession()` → Core API |
| `src/services/charge.service.ts:5` | `import { sendRemoteStopTransaction } from '@ocpp/commands/...'` | `IOcppGateway.stopSession()` → Core API |
| `src/services/charge.service.ts:6` | `import { connectionManager } from '@ocpp/connectionManager'` | Core API `/stations/:id/connection` |
| `src/ocpp/handlers/stopTransaction.handler.ts:3` | `import { postChargeBillingQueue } from '@jobs/queues'` | Redis Stream 이벤트 발행 |
| `src/ocpp/handlers/stopTransaction.handler.ts:4` | `import { refundService } from '@services/refund.service'` | Redis Stream 이벤트 발행 |
| `src/routes/index.ts:63-67` | Admin API에서 `@ocpp/commands` 직접 import | Core Internal API 호출로 대체 |
| `src/jobs/processors/chargeGoal.processor.ts:2` | `import { chargeService } from '@services/charge.service'` | Portal 내부 → Core API 경유 chargeService 사용 |

---

*문서 끝*

**작성자**: Project Design Architect  
**참조 코드베이스**: `D:/projects/chargeplus2` (브랜치: `fix/ocpp_message_log_all_directions`, 커밋: `e91d12e`)  
**참조 설계 가이드**: `documents/design_guide/01_system_architecture.md` ~ `13_charging_site_management.md`
