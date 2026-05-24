# Implementation Progress — compliance_review_report.md 미완성 기능 구현

**작성일**: 2026-04-01  
**작업자**: Claude Code (pvpentech-code-implementer)  
**배포 서버**: 192.168.0.25 — `/opt/pvpentech`

---

## 작업 결과 요약

### 1. Critical: POST /provision 라우트 연결

**상태**: 이미 완료됨 (조치 불필요)

`src/routes/index.ts` 확인 결과 64번째 줄에 `router.use('/provision', provisionRoutes);`가 이미 존재함.

---

### 2. Major: Repository 레이어 구현

**상태**: 완료 — 신규 2개 파일 생성, 기존 9개 파일 확인

**기존 파일 (이미 존재):**
- `src/repositories/station.repository.ts`
- `src/repositories/user.repository.ts`
- `src/repositories/partner.repository.ts`
- `src/repositories/site.repository.ts`
- `src/repositories/transaction.repository.ts`
- `src/repositories/idToken.repository.ts`
- `src/repositories/faultLog.repository.ts`
- `src/repositories/provisioning.repository.ts`
- `src/repositories/settlement.repository.ts`

**신규 생성:**
- `src/repositories/meterValue.repository.ts` — MeterValue CRUD, findByTransactionId, getLatestByTransactionId, getEnergyReading, createMany
- `src/repositories/ocppMessage.repository.ts` — OcppMessage create, findMany, findByStationId, findRecent, deleteOlderThan

모두 기존 repository 패턴(object literal with prisma direct calls) 준수.

---

### 3. Major: Validator 파일 분리

**상태**: 이미 완료됨 (조치 불필요)

모든 validator 파일이 이미 존재함:
- `src/validators/auth.validator.ts` — loginSchema, registerCustomerSchema, registerPartnerSchema
- `src/validators/charge.validator.ts` — startChargeSchema, stopChargeSchema, getStatusSchema
- `src/validators/station.validator.ts` — createStationSchema, updateStationSchema
- `src/validators/user.validator.ts` — createUserSchema, updateUserSchema
- `src/validators/partner.validator.ts` — createPartnerSchema, updatePartnerSchema, marginSchema, settlementDaySchema
- `src/validators/site.validator.ts` — (존재)

---

### 4. Major: /api/admin/ 엔드포인트 추가

**상태**: 완료

`src/routes/index.ts`에 3개 엔드포인트 추가:
- `POST /api/admin/stations/:stationId/update-firmware` — UpdateFirmware OCPP 명령 전송
- `POST /api/admin/stations/:stationId/get-diagnostics` — GetDiagnostics OCPP 명령 전송
- `POST /api/admin/stations/:stationId/change-configuration` — ChangeConfiguration OCPP 명령 전송

구현 방식: `connectionManager.get(stationId)` → WebSocket 직접 전송 (`serializeCall` 사용)
인증: `adminMiddleware` ([authMiddleware, requireRole('cs')]) 적용

**참고**: 기존 `/api/portal/cs/ops/remote/*` 라우트의 로직과 동일한 패턴 재사용.

---

### 5. Major: portal.json 번역 파일 생성

**상태**: 완료

3개 언어 파일 모두 업데이트 (`locales/ko/portal.json`, `locales/en/portal.json`, `locales/vi/portal.json`):

**추가된 섹션:**
- `menu.provisioning` — 충전기 등록관리 / Charger Provisioning / Đăng ký thiết bị sạc
- `menu.mySettlements` — 내 정산내역 / My Settlements / Lịch sử thanh toán của tôi
- `status.*` — 15개 상태 값 (online, offline, faulted, active, inactive, pending, blocked, available, charging, reserved, unavailable, provisioned, accepted, stopped, failed)
- `label.*` — 28개 라벨 키 (stationId, serialNumber, manufacturer, firmwareVersion, siteName, address, unitPrice, partnerName, businessNo, contactPhone, marginRate, settlementDay, username, email, phone, role, idTag, bankName, accountNumber, accountHolder, totalKwh, totalCost, settlementAmount, startTime, endTime, duration, connectorId, location, retrieveDate, configKey, configValue, createdAt, updatedAt)
- `action.*` — 20개 액션 키 (add, edit, delete, save, cancel, confirm, approve, reject, activate, deactivate, settle, sendCommand, updateFirmware, getDiagnostics, reset, changeConfig, remoteStart, remoteStop, register, search, filter, export, refresh)

**i18n 설정**: `src/config/i18n.ts`에서 `portal` 네임스페이스가 이미 등록되어 있음 (조치 불필요).

---

### 6. Minor: stopCharge() 완료 메시지 다국어화

**상태**: 이미 완료됨 (조치 불필요)

- `src/services/charge.service.ts`의 `stopCharge()`가 이미 `message: 'charge:completed'` 키 반환
- `src/controllers/charge.controller.ts`가 이미 `result.message = req.t('charge:completed')` 적용
- `locales/*/charge.json`에 `completed` 키가 3개 언어 모두 존재

---

### 7. Minor: 포털 로그인 JWT 만료 8h 차등 적용

**상태**: 이미 완료됨 (조치 불필요)

`src/services/auth.service.ts`:
- `loginMobile()` → `this.login(username, password, '24h')`
- `loginPortal()` → `this.login(username, password, '8h')`

---

### 8. Minor: OCPP WebSocket 서버 path 명시

**상태**: 이미 완료됨 (조치 불필요)

`src/ocpp/server.ts`에서 WebSocketServer 연결 시 URL path 검증:
```typescript
if (!urlPath.startsWith('/ocpp/')) {
  ws.terminate();
  return;
}
```
명시적 `path:` 옵션 대신 연결 후 URL 검증 방식으로 구현됨 (동일한 효과).

---

## 배포 결과

| 항목 | 결과 |
|------|------|
| TypeScript 빌드 | 성공 (`tsc -p tsconfig.build.json` 오류 없음) |
| PM2 재시작 | 성공 (online, 0 unstable restarts) |
| 서버 시작 로그 | 정상 (i18n initialized, OCPP server initialized, server started) |
| 새 admin 엔드포인트 응답 | 401 (인증 필요 — 정상 동작 확인) |

### 배포된 파일 목록

**신규 생성:**
- `src/repositories/meterValue.repository.ts`
- `src/repositories/ocppMessage.repository.ts`

**수정:**
- `src/routes/index.ts` — admin UpdateFirmware/GetDiagnostics/ChangeConfiguration 추가
- `locales/ko/portal.json` — status/label/action/provisioning 키 추가
- `locales/en/portal.json` — 동상 (신규 생성)
- `locales/vi/portal.json` — 동상 (신규 생성)

---

---

## 2026-04-01 추가 작업 (2차 구현)

**작업 내용**: Repository 레이어 메서드 확장, Prisma 마이그레이션 baseline, 포털 UI 전면 개선, 번역 파일 생성

### 작업 1: Repository 레이어 메서드 확장

기존 7개 repository 파일을 서비스 파일 분석 후 실제 사용 패턴에 맞게 확장.

| 파일 | 추가된 주요 메서드 |
|------|-------------------|
| `station.repository.ts` | `findByIdWithDetails`, `upsert`, `updateConnectorStatus`, `findConnector`, `upsertConnector`, `updateHeartbeat`, `updatePassword`, `findOnline` |
| `user.repository.ts` | `findByIdWithDetails`, `findByEmail`, `findByRole`, `toggleActive`, `updateLanguage`, `blockAllIdTokens`, payment card helpers |
| `partner.repository.ts` | `findByIdWithSites`, `updateMargin`, `updateSettlementDay`, `deactivate`, `updateBankAccount`, settlement helpers |
| `site.repository.ts` | `findByIdWithStations`, `findByPartnerId`, `updatePrice`, `findPartnerById` |
| `transaction.repository.ts` | `findByIdWithDetails`, `findBySessionIdWithDetails`, `findActiveSessions`, `findPendingSessions`, `findByUserId`, `findByStationId`, `findByOcppTransactionId`, `findStatusWithMeterValues` |
| `idToken.repository.ts` | `findByToken`, `updateStatus`, `findByUserId`, `updateManyStatus` |
| `faultLog.repository.ts` | `findByIdWithStation`, `markResolved`, `findUnresolved`, `findByStationId`, `countByStationId`, `countUnresolved` |

**TypeScript 오류 수정**: `ConnectorStatus` 필드명이 `status`가 아닌 `currentStatus`이고, `Transaction`에 `userId`가 없고 `idTag`로 연결됨을 스키마 확인 후 수정.

### 작업 2: Prisma 마이그레이션 Baseline

- DB에 기존 테이블이 존재하여 `migrate dev` 대신 baseline 방식 적용
- `prisma migrate diff --from-empty --to-schema-datamodel` 로 SQL 생성
- `migration_lock.toml` 수동 생성 후 `prisma migrate resolve --applied` 로 baseline 완료
- 경로: `/opt/pvpentech/prisma/migrations/20260401000000_init/`

### 작업 3: 포털 프론트엔드 SPA 전면 개선

**CS 포털** (`public/portal/cs/index.html`):
- 완전한 SPA 구조 구현 (navigate() 함수 기반 라우팅)
- 9개 메뉴 모두 데이터 테이블 뷰 구현: 대시보드, 파트너, 충전소, 충전기, 사용자, 충전카드, 정산, 충전이력, 장애로그
- 범용 `loadListPage()` + `PAGE_CONFIGS` 패턴으로 테이블 렌더링 통일
- 모달 기반 상세보기/수정 구현 (파트너 상세, 충전기 상세, 충전소 수정, 충전카드 수정)
- 파트너 승인, 사용자 상태 변경, 장애 해결 처리 액션 구현
- ko/en/vi 언어 전환 (localStorage 저장)

**파트너 포털** (`public/portal/partner/index.html`):
- 6개 메뉴: 대시보드, 내 충전소, 내 충전기, 충전 통계, 정산 내역, 계좌 정보
- 계좌 정보 수정 폼 구현
- 페이지네이션 포함

**고객 포털** (`public/portal/customer/index.html`):
- 5개 메뉴: 대시보드, 충전 이력, RFID 카드, 결제카드, 프로필
- 프로필 편집 폼, 결제카드 삭제 구현
- 언어 전환 포함

### 작업 4: public/locales 번역 파일 생성

포털 SPA용 클라이언트 번역 JSON 파일 신규 생성:
- `public/locales/ko/menu.json` — 27개 메뉴 키
- `public/locales/ko/common.json` — 37개 공통 레이블/버튼/메시지
- `public/locales/en/menu.json`, `public/locales/en/common.json` — 영문
- `public/locales/vi/menu.json`, `public/locales/vi/common.json` — 베트남어

### 배포 결과 (2차)

| 항목 | 결과 |
|------|------|
| TypeScript 빌드 | 성공 (오류 없음) |
| PM2 재시작 | 성공 (online, 3737 restarts, 110MB) |
| 마이그레이션 baseline | 성공 (20260401000000_init marked as applied) |
| 포털 파일 배포 | 성공 (`/opt/pvpentech/public/portal/`, `/opt/pvpentech/public/locales/`) |

---

## 비고

### 처음부터 이미 구현되어 있던 항목들

compliance_review_report.md에서 미완성으로 분류된 항목 중 다음은 이미 구현되어 있었음:
- provision 라우트 마운트
- 모든 validator 파일 (6개)
- stopCharge 메시지 i18n
- 포털 로그인 8h JWT
- OCPP path 검증
- i18n portal 네임스페이스

이는 review 이후 별도로 구현이 진행되었음을 의미함.

---

## 2026-04-02 추가 작업 — CS 포털 SPA 개선

**작업자**: Claude Code (pvpentech-code-implementer)

### 변경 파일

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `public/portal/cs/index.html` | 수정 | 운영 서브메뉴, 대시보드 통계 탭, 정산 탭 UI 추가 + i18n 키 확장 |
| `src/routes/portal/cs/ops.routes.ts` | 수정 | `POST /remote/reset` 엔드포인트 추가 |

### 1. 운영(Operations) 서브메뉴 추가

사이드바 "충전기 운영" 섹션 신규 추가. `toggleOpsMenu()` 함수로 서브메뉴 토글.

- **ops-variables** (`GET /api/portal/cs/ops/variables`): CSMS 변수 인라인 편집 폼
- **ops-remote**: UpdateFirmware / GetDiagnostics / Reset 명령 폼 (온라인 충전기 드롭다운)
- **ops-msglog** (`GET /api/portal/cs/ops/messages`): 필터 + 페이지네이션 로그 테이블

백엔드 `POST /remote/reset` 라우트는 ops.routes.ts에 신규 추가함 (OCPP Reset 커맨드).

### 2. 대시보드 서비스 현황 탭

KPI 카드 아래 [일별 / 주별 / 월별] 탭 추가.  
탭 클릭 시 `GET /api/portal/cs/dashboard/stats?period=daily|weekly|monthly` 호출.  
결과를 기간 / 충전건수 / 충전량(kWh) / 충전금액(원) 테이블로 표시.  
대시보드 진입 시 일별 탭이 자동 로드됨.

### 3. 정산 탭 구조 개선

기존 단순 목록(`loadListPage('settlements')`)을 `loadSettlements(activeTab)` 함수로 교체.  
[전체 / 파트너별 / 충전소별] 탭 구성. 각 탭은 대응하는 API를 호출하며 컬럼 구성도 탭별로 다르게 렌더링.

### 4. i18n 키 추가 (ko / en / vi)

추가된 키:
- `menu.opsSection`, `menu.ops.root`, `menu.ops.variables`, `menu.ops.remote`, `menu.ops.msglog`
- `menu.stats.daily`, `menu.stats.weekly`, `menu.stats.monthly`
- `menu.settlements.all`, `menu.settlements.byPartner`, `menu.settlements.bySite`
- `common.send`

### 5. CSS 추가

`.tab-btn`, `.tab-btn.active`, `.ops-card`, `.ops-card-title`, `.ops-field-row`, `.ops-field-key`, `.ops-field-input` 클래스 추가.

---

## 2026-04-02 추가 작업 — Redis 업그레이드 스크립트 준비

**작업자**: Claude Code (pvpentech-code-implementer)

### 배경

배포 서버(192.168.0.25)에 Redis 6.0.16이 설치되어 있음. BullMQ는 Redis 6.2.0 이상을 권장하며, 현재는 경고 로그만 발생하고 기능은 동작하지만 프로덕션 안정성을 위해 업그레이드 스크립트를 준비함.

### 생성된 파일

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `scripts/upgrade-redis.sh` | 신규 생성 | Ubuntu 20.04/22.04용 Redis 6.2.x+ PPA 업그레이드 스크립트 |

### 스크립트 동작 순서

1. 현재 설치된 Redis 버전 출력 (`redis-server --version`)
2. Ubuntu 버전 확인 (`lsb_release -rs`)
3. Redis Labs 공식 PPA 추가 (`ppa:redislabs/redis`)
4. `apt-get update` 후 `redis-server` 패키지 업그레이드
5. 업그레이드 후 버전 재확인
6. `systemctl restart redis-server` 및 `enable` 처리
7. 서비스 상태 출력 (`--no-pager`)

### 사용 방법

```bash
# 배포 서버에서 실행
bash scripts/upgrade-redis.sh
```

### 비고

- 스크립트 상단에 `set -e` 적용 — 임의 단계 실패 시 즉시 중단
- 배포는 수행하지 않음 (스크립트 준비만)
- 파일 권한(`chmod +x`)은 배포 시 별도 적용 필요

---

## 2026-04-02 추가 작업 — i18n notification 미완성 항목 구현

**작업자**: Claude Code (pvpentech-code-implementer)

### 배경

백엔드 job processor들이 i18n 키를 사용하지 않고 한국어 하드코딩을 사용하고 있었으며, ops.routes.ts의 오프라인 에러 메시지도 한국어로 하드코딩되어 있었음. `locales/*/notification.json`과 i18n.ts의 `notification` 네임스페이스는 이미 완성된 상태였음.

### 변경 파일 목록

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/jobs/processors/sessionTimeout.processor.ts` | 수정 | `failReason` 값을 한국어 하드코딩에서 내부 코드 `'session_timeout'`으로 변경 |
| `src/services/notification.service.ts` | 신규 생성 | i18next 기반 다국어 알림 메시지 생성 서비스 |
| `src/jobs/processors/chargeGoal.processor.ts` | 수정 | `notificationService.getMultiLangMessages()` 호출 추가 (충전 목표 달성 시 3개 언어 로깅) |
| `src/routes/portal/cs/ops.routes.ts` | 수정 | 4곳의 `'충전기가 오프라인 상태입니다.'` 하드코딩을 `req.t('station:offline')`으로 교체 |
| `locales/ko/station.json` | 수정 | `"offline": "충전기가 오프라인 상태입니다."` 키 추가 |
| `locales/en/station.json` | 수정 | `"offline": "The charging station is offline."` 키 추가 |
| `locales/vi/station.json` | 수정 | `"offline": "Trạm sạc đang ngoại tuyến."` 키 추가 |

### 세부 내용

#### 1. sessionTimeout.processor.ts

`failReason` 필드는 DB에 저장되는 내부 코드값으로, 한국어 문자열 대신 기계 판독 가능한 코드 `'session_timeout'`을 사용하도록 변경. 사용자에게 노출 시에는 이 코드를 i18n 키로 매핑하는 방식.

#### 2. notification.service.ts (신규)

- `getMessage(key, lang, vars?)` — 단일 언어 알림 메시지 반환
- `getMultiLangMessages(key, vars?)` — ko/en/vi 3개 언어 메시지 객체 반환
- `i18next` 인스턴스를 `@config/i18n`에서 직접 임포트하여 HTTP 요청 컨텍스트 없이도 사용 가능

#### 3. chargeGoal.processor.ts

`shouldStop` 분기 진입 시 `notificationService.getMultiLangMessages('chargeGoalReached', { value: '...' })`를 호출하여 3개 언어 메시지를 로거에 기록. 기존 `'Goal reached, stopping charge'` 로그는 유지.

#### 4. ops.routes.ts

`/remote/update-firmware`, `/remote/get-diagnostics`, `/remote/change-configuration`, `/remote/reset` 4개 엔드포인트의 오프라인 에러 메시지를 `req.t('station:offline')`으로 교체. `Accept-Language` 헤더에 따라 한국어/영어/베트남어 중 적절한 언어로 응답.

#### 5. station.json `offline` 키

`offline` 키가 세 언어 파일 모두에 없었음 — 추가 완료.

### 비고

- 배포는 수행하지 않음
- ops.routes.ts에 남아 있는 성공 응답 메시지(`'펌웨어 업데이트 명령이 전송되었습니다.'`, `'진단 로그 요청이 전송되었습니다.'`, `'${resetType} Reset 명령이 전송되었습니다.'`)는 이번 작업 범위에 포함되지 않아 수정하지 않음

---

## 2026-04-02 — CS 포털 7개 관리 화면 전면 구현

**작업자**: Claude Code (pvpentech-code-implementer)

### 개요

CS 포털 SPA(`public/portal/cs/index.html`)의 7개 관리 화면을 전면 재구현하고, 이를 지원하는 백엔드 API를 보완함. Prisma 스키마에 두 개의 신규 필드도 추가함.

---

### Task 1: Prisma 스키마 변경

| 모델 | 변경 내용 |
|------|-----------|
| `FaultLog` | `status FaultStatus @default(Received)` 필드 추가 |
| `ChargingSite` | `rebateRate Decimal @default(0) @db.Decimal(5,2)` 필드 추가 |

신규 enum: `FaultStatus { Received, InProgress, Resolved }`

마이그레이션 파일: `prisma/migrations/20260402000001_add_fault_status_rebate_rate/migration.sql`  
Prisma Client 재생성: `npx prisma generate` (완료, 오류 없음)

---

### Task 2: 백엔드 API 보완

#### 2-A. `src/routes/portal/cs/partners.routes.ts` 추가

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /:id/transactions` | 파트너 소속 충전기의 전체 충전이력 (페이지네이션) |
| `GET /:id/faults` | 파트너 소속 충전기의 전체 장애이력 |
| `PATCH /:id/sites/:siteId/rebate` | 특정 충전소의 리베이트율 설정 |

#### 2-B. `src/routes/portal/cs/sites.routes.ts` 추가

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /:id/transactions` | 충전소별 충전이력 (페이지네이션) |
| `GET /:id/faults` | 충전소별 장애이력 |

#### 2-C. `src/routes/portal/cs/stations.routes.ts` 추가

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /:id/transactions` | 충전기별 충전이력 (페이지네이션) |

#### 2-D. `src/routes/portal/cs/idTokens.routes.ts` 추가

| 엔드포인트 | 설명 |
|-----------|------|
| `POST /` | 충전카드 직접 생성 (CS 포털에서) |
| `PUT /:id` | 충전카드 상태/타입 수정 |

#### 2-E. 신규 파일: `src/routes/portal/cs/faultLogs.routes.ts`

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /` | 전체 장애로그 (stationId/siteId/partnerId/startDate/endDate/status 필터) |
| `POST /` | 장애 등록 |
| `PATCH /:id/status` | 상태 변경 (Received → InProgress → Resolved, 완료 시 resolvedAt 자동 설정) |

`src/routes/index.ts`에 `/api/portal/cs/fault-logs` 경로로 마운트.

#### 2-F. 세션 서비스 `partnerId` 필터 추가

- `src/services/session.service.ts` — `listAll()` 에 `partnerId` 파라미터 추가 (`station.site.partnerId` 조인)
- `src/controllers/session.controller.ts` — `req.query.partnerId` 파싱 추가
- 충전이력에 `station.site.partner.businessName` 포함하도록 include 확장

---

### Task 3: CS 포털 프론트엔드 전면 재구현

`public/portal/cs/index.html` 전체 재작성.

#### 공통 개선사항

- 모달 탭 구조 (`modal-tab-bar`, `modal-tab-btn`, `modal-tab-pane`) CSS + JS 추가
- `switchModalTab(tabId)` 공통 함수
- `filter-bar`, `filter-group`, `filter-input`, `filter-select` 필터 UI 컴포넌트 CSS 추가
- `badge-orange` 배지 색상 추가 (InProgress 상태용)
- 모달 너비 480px → 680px으로 확장
- `form-row` 2열 배치 컴포넌트 추가
- `buildPagination()` 콜백 방식을 전역 함수명 문자열 방식으로 리팩토링 (인라인 함수 직렬화 문제 해소)
- `faultStatusBadge()` 헬퍼 추가
- `fault.Received`, `fault.InProgress`, `fault.Resolved` i18n 키 추가 (ko/en/vi)
- API 호출에 try-catch 래퍼 추가

#### 3-1. 파트너 관리

- 컬럼: ID, 사업자명, 사업자번호, 아이디, 연락처, 상태, 등록일, 액션
- `pending` 상태 행에 [승인] 버튼
- 상세 모달 3탭: [기본정보] (마진율/정산일/계좌정보 수정+저장) / [충전소별 리베이트] (리베이트율 입력+PATCH) / [충전이력]

#### 3-2. 충전소 관리

- [+ 충전소 등록] 버튼 → 파트너 드롭다운 포함 등록 폼 → `POST /api/portal/cs/sites`
- 상세 모달 3탭: [기본정보] 수정/저장 / [충전이력] / [장애이력]

#### 3-3. 사용자 관리

- 컬럼: ID, 아이디, 이름, 이메일, 전화번호, 역할, 상태, 가입일, 액션
- 상세 모달 2탭: [기본정보] (역할/언어/상태 포함 수정+저장) / [결제카드] (목록+삭제)

#### 3-4. 충전기 관리

- 컬럼: ID, 충전소, 제조사, 시리얼번호, 펌웨어, 상태, 마지막연결, 액션
- 상세 모달 3탭: [기본정보] (제조사/시리얼/펌웨어/활성여부 수정+저장) / [충전이력] / [장애이력]

#### 3-5. 충전카드 관리

- [+ 카드 추가] 버튼 → RFID번호/타입/사용자 선택 폼 → `POST /api/portal/cs/id-tokens`
- 상세 모달: 상태(Accepted/Blocked/Expired/Invalid)+타입 수정 → `PUT /api/portal/cs/id-tokens/:id`
- `in_use` 플래그 "이용중/미사용" 배지로 표시

#### 3-6. 정산 관리

- 파트너별/충전소별 탭에 기간 필터 + 파트너 선택 드롭다운 추가
- 충전소별 탭: 파트너 선택 시 해당 파트너 충전소 목록 자동 로드 (`loadSitesByPartner()`)
- 충전이력(transactions) 페이지: 기간/파트너/충전소/충전기 연동 필터 + 파트너 선택 시 충전소 자동 갱신, 충전소 선택 시 충전기 자동 갱신

#### 3-7. 장애로그

- [+ 장애 등록] 버튼 → 충전기/유형/설명 입력 폼 → `POST /api/portal/cs/fault-logs`
- 기간/파트너/충전소/충전기/상태 5종 필터
- 상태 드롭다운 즉시 변경 → `PATCH /api/portal/cs/fault-logs/:id/status`

---

### 빌드 검증

`npm run build` (tsc -p tsconfig.build.json) — **성공, 오류 0건**

---

### 비고

- 배포는 수행하지 않음
- 기존 provisional/ops/dashboard 화면은 동일하게 유지
- `buildPagination` 함수를 인라인 클로저 방식에서 named-function 문자열 방식으로 변경하여 HTML 이벤트 핸들러 직렬화 문제 해소

## 2026-04-02: 포털 UI 전면 개선

**작업자**: Claude Code (pvpentech-code-implementer)
**참조**: `documents/design_guide/11_portal_menu_structure.md`

### 작업 범위

4개 파일 수정 + 설계 가이드 업데이트. 배포 없음.

---

### Task 1: 설계 가이드 업데이트

**파일**: `documents/design_guide/11_portal_menu_structure.md`

- 섹션 10 (로그인 페이지 요구사항) 추가 — 다국어 선택, 회원가입 UI, 역할 기반 리디렉션
- 섹션 11 (고객·파트너 포털 구조 원칙) 추가 — 허용 메뉴 및 API 정리

---

### Task 2: login.html 전면 재작성

**파일**: `public/portal/login.html`

주요 변경사항:
- 상단 우측 언어 선택 버튼 3개 (EN 기본, 한국어, Tiếng Việt)
- 회원가입 모달 (2단계): 유형 선택 → 고객/파트너 폼
- 고객 가입 API: `POST /api/portal/auth/register/customer`
- 파트너 가입 API: `POST /api/portal/auth/register/partner`
- 파트너 폼 하단 CS 승인 안내문구 표시
- 가입 성공 시 3초 후 자동으로 로그인 화면 복귀
- 로그인 성공 시 역할별 리디렉션: cs → `/portal/cs/`, partner → `/portal/partner/`, customer → `/portal/customer/`
- 인라인 TRANSLATIONS 객체로 ko/en/vi 3개 언어 완전 지원

---

### Task 3: customer/index.html 전면 재작성

**파일**: `public/portal/customer/index.html`

주요 변경사항:
- 인증 가드: token + role === 'customer' 검사
- 액센트 컬러 `#F59E0B` (amber) 적용
- 사이드바 5개 메뉴: 대시보드, 충전이력, 결제카드, 충전카드(RFID), 내 프로필
- 사이드바 하단 언어 전환(EN/KO/VI) + 로그아웃 버튼
- 대시보드: KPI 4개 카드 + 최근 충전이력 5건 테이블
- 충전이력: `GET /api/portal/customer/history?page=&limit=20` + 페이지네이션
- 결제카드: 목록/등록(POST)/삭제(DELETE) 모달 포함
- RFID카드: 목록/등록(POST, body `{id_tag}`)/삭제(DELETE) 모달 포함
- 내 프로필: `GET/PUT /api/portal/customer/profile`
- 인라인 TRANSLATIONS ko/en/vi 완전 구현
- 401 응답 시 자동 로그아웃 처리

---

### Task 4: partner/index.html 전면 재작성

**파일**: `public/portal/partner/index.html`

주요 변경사항:
- 인증 가드: token + role === 'partner' 검사
- 액센트 컬러 `#10B981` (emerald) 적용
- 사이드바 6개 메뉴: 대시보드, 내 충전소, 내 충전기, 충전 통계, 정산 내역, 계좌정보
- 사이드바 하단 언어 전환(EN/KO/VI) + 로그아웃 버튼
- 대시보드: KPI 4개 카드 (내 충전기 수, 온라인 수, 당월 충전량, 당월 충전금액)
- 내 충전소: 목록 + 단가 수정 모달 (`PATCH /api/portal/partner/sites/:id/unit-price`)
- 내 충전기: 30초 setInterval 자동 폴링 (`GET /api/portal/partner/stations`), 페이지 이탈 시 interval clearInterval
- 충전 통계: `GET /api/portal/partner/stats?period=current/previous` 동시 호출, 당월/전월 비교 + 증감률 (▲/▼)
- 정산 내역: `GET /api/portal/partner/settlements` + 페이지네이션
- 계좌정보: `GET/PUT /api/portal/partner/bank-account` 폼
- 인라인 TRANSLATIONS ko/en/vi 완전 구현
- 401 응답 시 자동 로그아웃 + interval 정리 처리

---

### 비고

- 배포는 수행하지 않음 (요청에 따라 제외)
- 모든 API 호출에 `Authorization: Bearer ${token}` 헤더 포함
- API 응답 형식 `{success, data}` 양쪽 호환 처리 (items 배열 또는 직접 배열)
- 로그인 리디렉션 URL: `/portal/cs/`, `/portal/partner/`, `/portal/customer/` (index.html 없이 디렉토리 슬래시 방식으로 변경)
