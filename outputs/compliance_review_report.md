# 디자인 가이드 준수 평가 보고서

- **작성일**: 2026-04-01
- **평가자**: Claude Code (Design Compliance Reviewer)
- **평가 기준**: `documents/design_guide/01~12` 전체 문서
- **평가 대상**: `src/`, `prisma/schema.prisma`, `locales/`, `public/`, 설정 파일 전체

---

## 완성도 종합 점수: 83/100

| 평가 항목 | 점수 | 비고 |
|-----------|------|------|
| 01 시스템 아키텍처 | 95/100 | 전반적으로 높은 준수율 |
| 02 디렉토리 구조 | 80/100 | repositories/validators 미구현 |
| 03 OCPP WebSocket | 95/100 | 전체 핸들러 구현 완료 |
| 04 DB 스키마 | 98/100 | 설계와 거의 완전 일치 |
| 05 REST API | 75/100 | 일부 누락 엔드포인트 존재 |
| 06 인증 | 90/100 | 핵심 인증 구현 완료 |
| 07 에러 핸들링 | 90/100 | 다국어 에러 처리 완성 |
| 08 환경/배포 | 95/100 | 거의 완전 구현 |
| 09 충전 세션 플로우 | 92/100 | 핵심 플로우 구현 완료 |
| 10 i18n | 72/100 | portal.json 누락, notification 미흡 |
| 11 포털 메뉴 구조 | 70/100 | 프론트엔드 단일 SPA로 축약 |
| 12 충전기 프로비저닝 | 88/100 | 공개 엔드포인트 미연결 |

---

## 01. 시스템 아키텍처 (95/100)

### 준수 항목

- Node.js 20 LTS + TypeScript 5.x 기반 단일 서버 구조 구현
- Express.js + ws 라이브러리를 동일 HTTP 서버에서 운용 (`server.ts` line 29: `initOcppWebSocketServer(httpServer)`)
- 레이어드 아키텍처: Router → Controller → Service → Repository 패턴 준수
- Prisma + PostgreSQL 연결 (`src/config/database.ts`)
- Redis + BullMQ 큐 통합 (`src/config/redis.ts`, `src/jobs/index.ts`)
- PM2 ecosystem.config.js 설정 완료
- i18next + i18next-http-middleware 통합 완료
- `process.on('unhandledRejection')`, `uncaughtException` 전역 핸들러 등록 (`server.ts` line 74~82)
- Graceful shutdown 구현 (`server.ts` line 44~69)
- Rate Limiting, CORS, Helmet 보안 미들웨어 적용

### 미준수 항목

- **Minor**: 디자인 가이드의 `server.ts`는 `bootstrap()` 함수 없이 직접 서버 기동을 예시로 제시했으나, 구현은 `bootstrap()` async 패턴 사용. 기능상 우수한 패턴이므로 긍정적 편차.

---

## 02. 디렉토리 구조 (80/100)

### 준수 항목

- `src/app.ts`, `src/server.ts` 진입점 구분 준수
- `src/config/` — index.ts, database.ts, redis.ts, logger.ts, i18n.ts, env.ts 전체 구현
- `src/routes/` — 요구 라우터 파일 대부분 구현 (portal/cs, partner, customer 서브디렉토리 분리)
- `src/controllers/` — 요구 컨트롤러 파일 전체 구현
- `src/services/` — 요구 서비스 파일 전체 구현 (`provision.service.ts` 포함)
- `src/ocpp/` — 전체 구조 구현 (server, connectionManager, messageParser, messageRouter, schemaValidator, pendingRequests, handlers/, commands/)
- `src/middlewares/` — 요구 미들웨어 전체 구현 (userLanguage 포함)
- `src/types/` — ocpp.types.ts, express.d.ts, common.types.ts 구현
- `src/utils/` — asyncHandler.ts, auth.ts, crypto.ts, errors.ts, jwt.ts, password.ts 구현
- `src/jobs/` — index.ts, queues.ts, processors/, schedulers/ 구현
- `locales/{ko,en,vi}/` — 8개 네임스페이스 파일 구조 구현
- `scripts/` — seed.ts, validateTranslations.ts, deploy.sh 구현
- `tsconfig.json` — paths 별칭 완전 설정
- `.env.example` — 모든 필수 환경 변수 포함

### 미준수 항목

- **Major**: `src/repositories/` 디렉토리가 존재하지만 **파일이 없음** (비어 있음). 디자인 가이드 02는 `station.repository.ts`, `user.repository.ts`, `partner.repository.ts` 등 9개 파일을 명시적으로 요구. 현재 서비스 레이어가 Prisma를 직접 호출하여 Repository 추상화 레이어가 사실상 미구현 상태.
- **Major**: `src/validators/` 디렉토리도 **파일이 없음**. 디자인 가이드는 `auth.validator.ts`, `charge.validator.ts`, `station.validator.ts`, `user.validator.ts`, `partner.validator.ts` 요구. Zod 스키마가 컨트롤러 파일 내부에 있을 수 있으나, 독립 파일로 분리되지 않음.
- **Minor**: `prisma/migrations/` 디렉토리 없음 (마이그레이션 실행 기록 없음).

---

## 03. OCPP 1.6 WebSocket 핸들러 (95/100)

### 준수 항목

**Upstream 핸들러 (CP → CSMS) — 8개 전체 구현:**

| Action | 파일 | 구현 상태 |
|--------|------|----------|
| BootNotification | `bootNotification.handler.ts` | 구현 |
| Heartbeat | `heartbeat.handler.ts` | 구현 |
| StatusNotification | `statusNotification.handler.ts` | 구현 |
| StartTransaction | `startTransaction.handler.ts` | 구현 |
| StopTransaction | `stopTransaction.handler.ts` | 구현 |
| Authorize | `authorize.handler.ts` | 구현 |
| MeterValues | `meterValues.handler.ts` | 구현 |
| DataTransfer | `dataTransfer.handler.ts` | 구현 |

**Downstream 명령 (CSMS → CP) — 4개 전체 구현:**

| Action | 파일 | 구현 상태 |
|--------|------|----------|
| RemoteStartTransaction | `remoteStartTransaction.command.ts` | 구현 |
| RemoteStopTransaction | `remoteStopTransaction.command.ts` | 구현 |
| Reset | `reset.command.ts` | 구현 |
| ChangeAvailability | `changeAvailability.command.ts` | 구현 |

**구조적 구현:**

- WebSocket 서버 초기화 (`ocpp/server.ts`) — `/ocpp/:stationId` 경로, `ocpp1.6` subprotocol 협상
- `connectionManager.ts` — 중복 연결 처리(기존 종료 후 재등록), isConnected 체크
- `messageParser.ts` — Call/CallResult/CallError 파싱/직렬화
- `messageRouter.ts` — Action → Handler 라우팅, 전역 try-catch로 Graceful Failure
- `pendingRequests.ts` — 30초 타임아웃 응답 대기 Map 구현
- OCPP Basic Auth 검증 (`verifyOcppBasicAuth` in `utils/auth.ts`) — DB 비밀번호 해시 비교
- `startTransactionHandler` — Pending → Active 상태 전환 + Connector 상태 업데이트
- `stopTransactionHandler` — Stopped 상태 전환 + 요금 계산 + Connector Available 전환
- OCPP 메시지 전체 DB 로깅 (`ocppMessage.service.ts`)

### 미준수 항목

- **Minor**: `ocpp/server.ts`에서 WebSocket 서버 경로 파라미터(`path: '/ocpp'`)가 설정되지 않음. 대신 connection 콜백에서 URL 파싱으로 stationId를 추출. 이 방식은 `/ocpp` 외 경로에서도 OCPP 연결을 수락할 수 있는 잠재적 문제점.
- **Minor**: `schemaValidator.ts` 구현 존재하나 실제 OCPP 1.6 JSON Schema 파일들의 존재 여부 미확인.

---

## 04. DB 스키마 (98/100)

### 준수 항목

디자인 가이드 04의 Prisma 스키마와 실제 `prisma/schema.prisma`가 **완전히 일치**.

구현된 모델 전체:
- `ChargingStation` — id(EN+7자리), manufacturer, passwordHash, vendorName, firmwareVersion, serialNumber 포함
- `Connector` — ConnectorStatus enum 9개 값 전체
- `ChargingSite` — chargeOperatorName, managerName, managerPhone 신규 필드 포함
- `User` — language 필드 추가 (디자인 가이드 기본 스키마 초과 구현)
- `PartnerProfile` — marginRate, settlementDay, bankName, bankAccount, bankAccountHolder 신규 필드 포함
- `PaymentCard` — billingKey 포함
- `IdToken` — IdTokenType 8개 값, IdTokenStatus 5개 값
- `Transaction` — TransactionStatus 4개 값, GoalType 4개 값
- `MeterValue` — (transactionId, timestamp) 복합 인덱스
- `DeviceVariable` — (stationId, componentName, variableName) 유니크 제약
- `OcppMessage` — 4개 인덱스 (station_id, created_at), (created_at), (action), (station_id, action) 전체 구현
- `FaultLog` — resolvedAt 인덱스 포함
- `ChargerProvisioning` — ProvisioningStatus 4개 값, serialNumber/status 인덱스
- `StationIdSequence` — lastNumber=1000000 기본값
- `Settlement` — SettlementPeriod(instant 포함), SettlementStatus, 3개 인덱스
- `CsmsVariable` — 키/값 시스템 변수

### 미준수 항목

- **Minor**: `prisma/migrations/` 디렉토리 없음. 실제 DB 마이그레이션이 실행되지 않은 상태로 보임.

---

## 05. REST API (75/100)

### 준수 항목

**모바일 충전 API:**
- `POST /api/login` — 앱 스펙 응답 형식(`{ success, token }`) 유지
- `POST /api/charge/start` — Pending 세션 생성, RemoteStart 비동기 전송
- `GET /api/charge/status` — MeterValue 기반 kWh 계산
- `POST /api/charge/stop` — RemoteStop + 요금 계산 (`Math.floor(kwh * unitPrice)`)
- appErrorHandler 적용 (`charge.routes.ts` — `{ detail: "..." }` 형식)

**포털 인증 API:**
- `POST /api/portal/auth/login`, logout, register/customer, register/partner, register/cs 구현

**CS 포털 API (대부분 구현):**
- 대시보드, 파트너 관리, 충전소 관리, 충전기 관리, 사용자 관리
- 정산 관리 (`/api/portal/cs/settlements`)
- 충전카드 관리 (`/api/portal/cs/id-tokens`)
- 프로비저닝 관리 (`/api/portal/cs/provisioning`)
- 운영 API (`/api/portal/cs/ops/variables`, `ops/messages`, `ops/remote/*`)
- 파트너 마진율 설정 (`PATCH .../partners/:id/margin`)
- 정산일자 설정 (`PATCH .../partners/:id/settlement-day`)
- 파트너 비활성화 (`PATCH .../partners/:id/deactivate`)
- 충전기 운영변수, 원격지원 (UpdateFirmware, GetDiagnostics, ChangeConfiguration) — ops.routes.ts에 구현

**파트너 API:**
- 대시보드, 내 충전소, 내 충전기, 통계, 정산 내역, 계좌정보 전체 구현

**고객 API:**
- 대시보드, 충전이력, RFID 카드, 결제카드, 프로필 전체 구현

**OCPP 관리 API:**
- RemoteStart, RemoteStop, Reset, ChangeAvailability, status 구현

### 미준수 항목

- **Critical**: `POST /provision` 엔드포인트가 존재하나 (`src/routes/provision.routes.ts`) **메인 라우터(`src/routes/index.ts`)에 마운트되지 않음**. 충전기 프로비저닝의 핵심 공개 API가 실제로 동작하지 않는 상태.

- **Major**: `/api/admin/stations/:stationId/update-firmware`, `/api/admin/stations/:stationId/get-diagnostics`, `/api/admin/stations/:stationId/change-configuration` 3개 엔드포인트 미구현. 이 기능들은 `/api/portal/cs/ops/remote/*` 경로에만 구현되어 있으며, 디자인 가이드 05가 명시한 `/api/admin/` 경로와 불일치.

- **Minor**: `GET /api/portal/cs/sessions` 엔드포인트는 구현되어 있으나, 디자인 가이드 명세의 필터 파라미터(`siteId=`, `stationId=`, `userId=`) 지원 여부 별도 확인 필요.

- **Minor**: `GET /api/portal/cs/dashboard/stats/detail` (상세내역) 엔드포인트 구현 여부 불명확.

---

## 06. 인증 (90/100)

### 준수 항목

- JWT HS256, 24h 만료, JWT_SECRET 32자 이상 검증 (`src/utils/jwt.ts`)
- `authMiddleware` — Bearer 토큰 검증, 401 응답
- `requireRole` 미들웨어 — cs/partner/customer 역할 분기
- bcrypt SALT_ROUNDS 12 (`src/utils/password.ts`)
- OCPP Basic Auth 검증 (`verifyOcppBasicAuth`) — DB 비밀번호 해시 비교
- 파트너 `pending` 상태 로그인 시 401 + 'auth:pendingApproval' messageKey 반환
- 고객 즉시 active, 파트너/CS pending 처리
- `/api/portal/cs/*` — cs 전용, `/api/portal/partner/*` — partner 전용, `/api/portal/customer/*` — customer 전용, `/api/admin/*` — cs 전용 Role Guard 적용
- 프로비저닝 Rate Limiting — 분당 5회 (`provisionRateLimiter`)
- 로그인 Rate Limiting — 분당 10회 (`loginRateLimiter`)

### 미준수 항목

- **Major**: `/api/portal/auth/login` (포털 로그인)과 `/api/login` (앱 로그인)의 JWT 만료 시간 차등 적용이 디자인 가이드(앱: 24h, 포털: 8h)에 명시되어 있으나, 현재 구현에서 포털 로그인도 24h를 사용하는지 확인 필요.
- **Minor**: 고객 비활성화 시 해당 사용자의 `IdToken.status = Blocked` 자동 전환 로직(`toggle-active` 핸들러)의 구현 여부 별도 확인 필요.
- **Minor**: Redis 블랙리스트 기반 즉시 토큰 무효화 미구현 (설계 정책상 선택적 사항으로 명기되어 있음).

---

## 07. 에러 핸들링 (90/100)

### 준수 항목

- 커스텀 에러 클래스 완전 구현: `AppError`, `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `UnprocessableError`, `InternalError` — 모두 `code`(고정 영문값) + `messageKey`(i18next 번역 키) 분리
- 전역 에러 핸들러 `errorHandlerMiddleware` — Zod 에러, AppError, 예상 외 에러 3단계 분기
- `req.t(error.messageKey)` 패턴으로 Accept-Language 기반 다국어 메시지 반환
- 앱 호환 에러 핸들러 `appErrorHandler` — `{ detail: "..." }` 형식, 다국어 적용, charge.routes.ts에 등록
- OCPP Graceful Failure — messageRouter의 try-catch로 어떤 예외도 서버 크래시 없이 CallError로 응답
- `asyncHandler` 유틸리티 구현 및 사용
- `process.on('unhandledRejection')`, `uncaughtException` 전역 핸들러
- `charge.service.ts` — `NotFoundError('...', 'charge:stationNotFound')`, `ConflictError('...', 'charge:alreadyInUse')` 등 messageKey 명시
- 로깅 레벨: 500+ → error, 400~499 → warn 분기

### 미준수 항목

- **Minor**: `charge.service.ts`의 `stopCharge()` 반환 `message` 필드가 한국어 하드코딩(`'충전이 완료되었습니다...'`) — `req.t('charge:completed')`로 다국어 처리되어야 함. 서비스 레이어에서 t 함수를 받지 않는 구조이므로 컨트롤러 레이어에서 처리 필요.
- **Minor**: OCPP `classifyOcppError` 함수가 설계 가이드 예시와 동일하게 구현되었는지 별도 확인 필요.

---

## 08. 환경/배포 (95/100)

### 준수 항목

- `.env.example` — 설계 가이드 명세 전체 변수 + `CSMS_SERVER_URL`, `PROVISION_ALLOWED_CIDRS` 신규 변수 포함
- Zod 기반 환경 변수 검증 (`src/config/env.ts`) — 모든 필수 변수 타입/기본값 검증
- `PM2 ecosystem.config.js` — 단일 인스턴스 fork 모드, 1G 메모리 제한, 로그 파일 설정
- `package.json` 스크립트 — dev, build, start, db:migrate, db:seed, test, lint, format, validate-translations 전체 구현
- `tsconfig.json` — paths 별칭 완전 설정, 빌드 대상 설정
- 주요 의존성 전체 구현: express, ws, prisma, ioredis, bullmq, jsonwebtoken, bcrypt, zod, pino, cors, helmet, express-rate-limit, i18next 패키지
- Graceful shutdown (SIGTERM, SIGINT) 구현
- health check 엔드포인트 (`/health`)

### 미준수 항목

- **Minor**: `PM2 ecosystem.config.js`에서 `script: 'node'`, `args: '-r module-alias/register dist/server.js'` 방식을 사용. 디자인 가이드는 `script: 'dist/server.js'` 방식을 명시. 기능상 동일하나 방식 불일치.
- **Minor**: `prisma/migrations/` 디렉토리 없음 (마이그레이션 파일 미생성 상태).
- **Minor**: ESLint `.eslintrc.json`, Prettier `.prettierrc` 설정 파일 존재 여부 미확인.

---

## 09. 충전 세션 플로우 (92/100)

### 준수 항목

- **Pending → Active → Stopped** 전체 상태 전환 구현
  - `startCharge()` → Transaction(Pending) 생성 → RemoteStartTransaction 비동기 전송
  - `startTransactionHandler()` → Pending → Active 전환, meterStart 저장, Connector 상태 Charging
  - `stopTransactionHandler()` → Active → Stopped 전환, meterEnd, costKrw, timeEnd 저장, Connector 상태 Available
- `startCharge()` — 충전기 존재 확인 + 중복 세션 방지 + 오프라인 체크 구현
- `getStatus()` — MeterValue 기반 kWh 계산, Pending/Active 분기
- `stopCharge()` — RemoteStop → StopTransaction 수신 플로우, 요금 계산(충전소 단가 우선, 기본 250원)
- RemoteStart 실패 시 Failed 상태 전환 (`sendRemoteStartAsync`)
- Pending 세션 5분 타임아웃 → Failed 처리 (`sessionTimeout.processor.ts`)
- 충전 목표 달성 자동 종료 Job (`chargeGoal.processor.ts`)
- StartTransaction 수신 시 RFID 개시 트랜잭션(sessionId 불일치) 신규 레코드 생성 처리
- `sessionId = session_${Date.now()}` — 앱 스펙 호환 세션 ID 형식

### 미준수 항목

- **Minor**: 디자인 가이드는 시퀀스 다이어그램에서 RemoteStop 후 `StopTransaction` OCPP 메시지를 CP에서 수신한 시점에 최종 상태를 업데이트하도록 설계. 현재 구현에서 `stopCharge()`는 RemoteStop 전송 즉시 DB를 Stopped로 업데이트하여 `StopTransaction` 핸들러의 meterEnd와 중복 업데이트 될 수 있음.
- **Minor**: 충전 목표 자동 종료 Job 등록(스케줄 큐에 충전 시작 시 Job enqueue)의 실제 구현 여부 별도 확인 필요.

---

## 10. i18n 다국어 지원 (72/100)

### 준수 항목

- `i18next` + `i18next-fs-backend` + `i18next-http-middleware` 패키지 설치 완료
- `src/config/i18n.ts` — Backend, LanguageDetector 초기화, 3개 언어 preload, 8개 네임스페이스, 폴백 ko, saveMissing + missingKeyHandler 로깅
- Express 미들웨어에 `i18next-http-middleware.handle(i18n)` 등록 (라우터보다 앞)
- `locales/{ko,en,vi}/` 3개 언어 디렉토리 구현
- **8개 네임스페이스 파일 3언어 전체 구현**:
  - `common.json`, `error.json`, `auth.json`, `charge.json`, `station.json`, `user.json`, `partner.json`, `notification.json` — ko/en/vi 24개 파일
- `error.json` — unauthorized, forbidden, notFound, conflict, validationFailed, internalServer 3언어 구현
- `charge.json` — stationNotFound, alreadyInUse, stationOffline, sessionNotFound, completed, startFailed 등 3언어 구현
- `userLanguage.middleware.ts` — DB 저장 언어 설정 폴백 미들웨어 구현
- `scripts/validateTranslations.ts` — 번역 누락 키 검증 스크립트 구현
- `package.json` `validate-translations` 스크립트 등록

### 미준수 항목

- **Major**: `locales/{ko,en,vi}/portal.json` 파일 **미구현**. 디자인 가이드 11은 포털 메뉴 전용 번역 파일(`portal.json`)을 명시. 포털 메뉴명 번역 키(`menu.dashboard`, `menu.partners`, `menu.mySites` 등)가 없는 상태.
- **Major**: `public/locales/{ko,en,vi}/` 디렉토리 없음. 관리자 포털 프론트엔드용 번역 파일 미구현. 디자인 가이드 10은 포털 `public/locales/{lang}/common.json`, `menu.json`, `dashboard.json`, `station.json`, `error.json`을 요구.
- **Minor**: `i18n.ts`에 8개 네임스페이스를 등록했으나 `portal` 네임스페이스가 없어 포털 메뉴명 번역 불가.
- **Minor**: `charge.service.ts`의 `stopCharge()` 반환 메시지가 한국어 하드코딩 (`'충전이 완료되었습니다...'`) — `charge:completed` 번역 키 미사용.

---

## 11. 포털 메뉴 구조 (70/100)

### 준수 항목

**백엔드 API 라우트 구조:**
- `src/routes/portal/cs/` — dashboard, partners, sites, stations, users, idTokens, settlements, ops, provisioning 9개 라우트 파일 구현
- `src/routes/portal/partner/` — dashboard, sites, stations, stats, settlements, bankAccount 6개 파일 구현
- `src/routes/portal/customer/` — dashboard, history, rfidCards, paymentCards, profile 5개 파일 구현
- `/api/portal/{role}/{resource}` URL 패턴 준수
- Role Guard 미들웨어 각 포털 라우트에 적용 (`csMiddleware`, `partnerMiddleware`, `customerMiddleware`)
- CS 대시보드 KPI API 구현 (충전기 수, 사용자 수, 충전 현황, 장애 현황)
- CS 대시보드 서비스 현황 탭 (일별/주별/월별 통계)

**구현 누락 또는 미흡 (백엔드):**
- 파트너 마진율/정산일자/비활성화/계좌정보 API 구현
- 즉시 정산 API + Settlement 레코드 생성
- 충전카드 이용중 여부 실시간 표시 API
- 고객 결제카드 CRUD
- 충전소 신규 필드(chargeOperatorName, managerName, managerPhone) 포함

### 미준수 항목

- **Major**: **프론트엔드 포털 UI가 역할별로 단일 `index.html` 파일 하나뿐**. 디자인 가이드 11이 명시한 CS/파트너/고객 각각의 세분화된 메뉴 페이지(대시보드, 파트너 관리, 충전소 관리, 충전기 관리, 사용자 관리, 충전카드 관리, 정산 관리, 운영, 내 충전소, 내 충전기, 통계, 정산 내역, 계좌정보, 충전이력, 결제카드, RFID 카드, 프로필 등)가 개별 HTML/JS 페이지로 구현되지 않음.
  - `public/portal/cs/index.html` — 단일 파일
  - `public/portal/partner/index.html` — 단일 파일
  - `public/portal/customer/index.html` — 단일 파일
  (SPA 구조일 수 있으나 실제 메뉴 기능 구현 여부 확인 불가)
- **Minor**: CS 대시보드 `stats/detail` (상세내역 링크) 엔드포인트 구현 여부 불명확.
- **Minor**: `public/locales/` 포털 번역 파일 디렉토리 없음 (섹션 10에서도 언급).

---

## 12. 충전기 프로비저닝 (88/100)

### 준수 항목

- `ChargerProvisioning` DB 모델 완전 구현 (ProvisioningStatus 4개 값, serialNumber 유니크, status/serialNumber 인덱스)
- `StationIdSequence` 모델 구현 (lastNumber=1000000)
- `ChargingStation.passwordHash`, `manufacturer` 신규 필드 추가
- `provision.service.ts` — 미등록 시리얼번호 403, 중복 409, EN+7자리 원자적 시퀀스 생성, bcrypt 해시 저장, 평문 1회 반환 구현
- `generateRandomPassword(32)` crypto 기반 랜덤 비밀번호 생성 (`utils/crypto.ts`)
- OCPP Basic Auth 검증에서 `ChargingStation.passwordHash` 조회
- CS 포털 프로비저닝 관리 API: GET/POST/GET:id/DELETE/PATCH:id/revoke 구현 (`portal/cs/provisioning.routes.ts`)
- `POST /api/portal/cs/stations/:id/reset-password` 구현
- Rate Limiting `provisionRateLimiter` — 분당 5회 제한
- 프로비저닝 완료 후 `status='provisioned'` → 재사용 방지
- `.env.example`에 `CSMS_SERVER_URL`, `PROVISION_ALLOWED_CIDRS` 포함

### 미준수 항목

- **Critical**: `POST /provision` 공개 엔드포인트 파일(`src/routes/provision.routes.ts`)은 존재하나, **메인 라우터(`src/routes/index.ts`)에 마운트되지 않음**. 충전기가 현장에서 호출하는 핵심 프로비저닝 API가 실제로 서비스되지 않는 상태.
  ```typescript
  // src/routes/index.ts에 추가 필요:
  import provisionRoutes from './provision.routes';
  router.use('/provision', provisionRoutes);
  ```
- **Minor**: 시간당 20회 Rate Limiting이 설계 명세에 있으나 분당 5회만 구현. `express-rate-limit`의 단일 미들웨어로 두 조건을 동시 적용하려면 미들웨어 체이닝 필요.

---

## 우선순위별 조치 사항

### Critical (즉시 수정 필요)

1. **`POST /provision` 라우트 미연결** (`src/routes/index.ts`)
   - `src/routes/provision.routes.ts`가 구현되어 있으나 메인 라우터에 마운트되지 않음
   - 수정: `routes/index.ts`에 `router.use('/provision', provisionRoutes)` 추가
   - 영향: 충전기 프로비저닝 전체 기능 불동작

### Major (중요 개선 필요)

2. **Repository 레이어 미구현** (`src/repositories/` 비어 있음)
   - 디자인 가이드가 요구하는 9개 Repository 파일 없음
   - 현재 서비스 레이어가 Prisma를 직접 호출하는 구조로 Repository 추상화 없음
   - 수정: `station.repository.ts`, `user.repository.ts`, `partner.repository.ts`, `site.repository.ts`, `transaction.repository.ts`, `meterValue.repository.ts`, `idToken.repository.ts`, `ocppMessage.repository.ts`, `faultLog.repository.ts` 구현

3. **Validator 파일 분리 미구현** (`src/validators/` 비어 있음)
   - Zod 스키마가 컨트롤러 내부에 있을 가능성이 높으나 독립 파일로 분리되지 않음
   - 수정: `auth.validator.ts`, `charge.validator.ts`, `station.validator.ts`, `user.validator.ts`, `partner.validator.ts` 생성

4. **`/api/admin/` UpdateFirmware, GetDiagnostics, ChangeConfiguration 미구현**
   - 디자인 가이드 05가 `/api/admin/stations/:stationId/update-firmware` 등을 요구
   - 현재 동일 기능이 `/api/portal/cs/ops/remote/*` 에만 구현됨
   - 수정: `routes/index.ts`의 admin 섹션에 3개 엔드포인트 추가

5. **포털 `portal.json` 번역 파일 미구현**
   - `locales/{ko,en,vi}/portal.json` 미생성
   - 포털 메뉴명, 레이블 다국어 지원 불가
   - 수정: 디자인 가이드 11의 i18n 키 목록을 기반으로 3언어 portal.json 생성

6. **포털 프론트엔드 미완성**
   - 각 역할별 단일 `index.html` 파일만 존재, 실제 UI 페이지 미구현 (또는 SPA 구조 내 기능 구현 여부 확인 필요)

### Minor (개선 권장)

7. **Prisma 마이그레이션 파일 생성**: `npx prisma migrate dev` 실행하여 `prisma/migrations/` 디렉토리 생성
8. **`stopCharge()` 완료 메시지 다국어화**: 한국어 하드코딩을 `charge:completed` 번역 키로 교체
9. **포털 로그인 JWT 만료 8h 차등 적용** 확인 및 구현
10. **OCPP WebSocket 서버 `path: '/ocpp'` 명시적 설정**: `new WebSocketServer({ server, path: '/ocpp', ... })`
11. **`public/locales/` 포털 번역 파일 구조 생성** (프론트엔드 SPA용)
12. **프로비저닝 시간당 20회 Rate Limiting** 추가 (분당 5회와 함께 체이닝)
13. **테스트 파일 미구현** (`tests/unit/`, `tests/integration/` 비어 있음) — 핵심 비즈니스 로직 단위/통합 테스트 작성 필요

---

## 종합 의견

Pvpentech CSMS의 구현은 **전체적으로 높은 완성도(83/100)**를 보입니다. 특히 OCPP 1.6 WebSocket 핸들러, DB 스키마, 충전 세션 플로우, 에러 핸들링 + 다국어 지원 등 핵심 기능들이 디자인 가이드에 충실하게 구현되어 있습니다.

**가장 우선 조치가 필요한 사항**은 `POST /provision` 라우트 미연결 문제입니다. 충전기 프로비저닝 서비스(`provision.service.ts`, `provision.controller.ts`, `provision.routes.ts`)가 완전히 구현되어 있음에도 불구하고, 메인 라우터에 마운트되지 않아 실제 서비스가 불가능한 상태입니다. 단 한 줄의 코드 추가로 해결되는 문제입니다.

**구조적 개선 관점**에서는 Repository 레이어와 Validator 파일의 독립 구현이 필요합니다. 현재 서비스 레이어가 Prisma를 직접 호출하는 방식은 테스트 작성 어려움과 DB 추상화 부재라는 장기적 유지보수 리스크를 내포합니다.

**i18n 측면**에서는 백엔드 API 다국어 지원은 잘 구현되어 있으나, 포털 메뉴 전용 `portal.json` 번역 파일이 누락되어 프론트엔드의 다국어 메뉴 구현에 공백이 있습니다.

전체적으로 백엔드 API 기능은 약 85~90% 완성되어 있으며, 프론트엔드 포털 UI의 실제 구현 완성도가 전체 점수를 낮추는 주요 요인입니다.
