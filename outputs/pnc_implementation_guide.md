# Pvpentech CSMS — ISO 15118 PnC 구현 가이드

- **작성일**: 2026-05-11
- **대상**: CSMS 에 ISO 15118 PnC 를 새로 구현하려는 개발팀
- **참고**: 본 문서는 Pvpentech CSMS 가 7개 PR (Phase A-1 ~ B-2 + UI) 로 PnC 를 구현한 실제 작업 절차·코드 구조·설계 결정을 정리한 것. 다른 CSMS 도 동일 패턴으로 적용 가능.
- **근거 스펙**: `documents/design_guide/csms_pnc_implementation_spec_2026-05-11.md` (902줄)
- **기술 스택**: Node.js / TypeScript / Express / Prisma (PostgreSQL) / OCPP 1.6J WebSocket

---

## 목차

1. [사전 이해 — PnC 의 본질과 CSMS 의 역할](#1-사전-이해--pnc-의-본질과-csms-의-역할)
2. [핵심 설계 결정 5가지](#2-핵심-설계-결정-5가지)
3. [전체 작업 분해 — 7개 PR 의 의존성 그래프](#3-전체-작업-분해--7개-pr-의-의존성-그래프)
4. [Phase A-1 — 인프라 (env / DB 스키마 / audit)](#4-phase-a-1--인프라-env--db-스키마--audit)
5. [Phase A-2 — 사내 PKI REST 클라이언트](#5-phase-a-2--사내-pki-rest-클라이언트)
6. [Phase A-3 — CSMS→CP 송신 5종 (wrapped DataTransfer)](#6-phase-a-3--csmscp-송신-5종-wrapped-datatransfer)
7. [Phase A-4 — BootNotification 직후 PnC config 자동 sync](#7-phase-a-4--bootnotification-직후-pnc-config-자동-sync)
8. [Phase B-1 — CP→CSMS 4 handler](#8-phase-b-1--cpcsms-4-handler)
9. [Phase A-5 — OCSP relay (RFC 6960 / 의존성 0)](#9-phase-a-5--ocsp-relay-rfc-6960--의존성-0)
10. [Phase B-2 — 만료 모니터링 + UI](#10-phase-b-2--만료-모니터링--ui)
11. [외부 인프라 가정 / CSMS 외부 의존성](#11-외부-인프라-가정--csms-외부-의존성)
12. [검증 절차 (단계별)](#12-검증-절차-단계별)
13. [회피한 함정 / 트레이드오프](#13-회피한-함정--트레이드오프)
14. [단계 2 (공공 V2G PKI) 확장 구조](#14-단계-2-공공-v2g-pki-확장-구조)
15. [부록 — 파일 목록 / 라인 수 / 라이브러리 결정](#15-부록--파일-목록--라인-수--라이브러리-결정)

---

## 1. 사전 이해 — PnC 의 본질과 CSMS 의 역할

### 1.1 PnC 가 풀고자 하는 문제

EV 가 케이블만 연결하면 별도 카드 태깅 없이 자동으로 인증·과금되도록 하는 게 ISO 15118 Plug & Charge 의 목표. 이 과정에서 **세 가지 X.509 인증서 계층**이 등장:

| 계층 | 소유 | 역할 |
|---|---|---|
| V2G Root CA | 인증기관 (단계 1 = 사내 PKI / 단계 2 = 공공) | 최상위 신뢰 root |
| Sub CA (CPO / OEM / MO / CPS) | 인증기관 | Root 가 서명. 각 도메인별 발급 |
| Leaf (EVSE / Contract) | 충전기 / 차량 | Sub CA 가 서명. 실제 TLS · 서명에 사용 |

### 1.2 CSMS 의 4가지 역할

1. **OCPP DataTransfer 라우터** — 충전기(CP) ↔ CSMS 사이는 OCPP 1.6 WebSocket 만. PnC 메시지는 `DataTransfer` 안에 OCPP 2.0.1 메시지를 JSON-string 래핑해 송수신
2. **인증서 라이프사이클 중계** — CP 의 CSR 을 사내 V2G PKI 에 전달해 서명된 leaf 받기·폐기·root 푸시·목록 조회
3. **OCSP relay** — CP 가 보낸 OCSP request 데이터를 RFC 6960 DER 로 빌드해 responder 에 POST 하고 응답 DER 을 그대로 base64 인코딩해 회신
4. **만료 모니터링** — leaf 가 만료 임박이면 CP 에 `TriggerMessage` 보내 새 CSR 송신 유도

> CSMS 는 인증서 발급 권한이 없음. PKI 가 발급하고 CSMS 는 중계만. OCSP 결과의 `good/revoked/unknown` 파싱도 CSMS 는 안 함 — EV 가 함.

### 1.3 OCPP DataTransfer wrapping 규칙

이게 PnC over OCPP 1.6 의 핵심 트릭. 모든 PnC 메시지가 다음 형식으로 OCPP CALL 안에 래핑됨:

```json
[
  2,
  "<msg-uuid>",
  "DataTransfer",
  {
    "vendorId": "org.openchargealliance.iso15118pnc",
    "messageId": "<OCPP 2.0.1 메시지명>",
    "data": "<JSON.stringify(OCPP 2.0.1 body)>"   ⚠ object 아닌 string
  }
]
```

`data` 가 **JSON string** 이라는 점이 중요. 핸들러/송신측 양쪽에서 stringify/parse 를 반복해야 함. 한 헬퍼로 추상화하지 않으면 유지보수 지옥.

---

## 2. 핵심 설계 결정 5가지

이 결정들을 먼저 합의해야 후속 작업이 깔끔합니다. 결정의 근거까지 명시:

### 2.1 vendorId/messageId 라우팅 = 레지스트리 패턴

OCPP DataTransfer 는 임의 확장점이라 `if-elif messageId` 인라인 처리하면 PnC 9개 + 기존 vendor 메시지가 한 파일에서 폭주. 우리는 **`dataTransferRegistry.register(vendorId, messageId, handler)`** 패턴으로 코어 핸들러는 lookup 만 하고 sub-handler 에 위임. 신규 vendor 메시지 추가 시 코어 코드 변경 0.

**자세한 구현**: 우리는 이미 Phase 4-A (OCPP 일반 스펙 준수) 에서 만들었음. PnC 는 그 위에 등록만 함:

```ts
// 부팅 시 1회
dataTransferRegistry.register(PNC_VENDOR_ID, 'Authorize', pncAuthorizeHandler);
dataTransferRegistry.register(PNC_VENDOR_ID, 'SignCertificate', pncSignCertificateHandler);
dataTransferRegistry.register(PNC_VENDOR_ID, 'Get15118EVCertificate', pncGet15118EvCertificateHandler);
dataTransferRegistry.register(PNC_VENDOR_ID, 'GetCertificateStatus', pncGetCertificateStatusHandler);
```

### 2.2 환경변수 분리 = 단계 2 전환 비용 0

스펙은 단계 1 (사내 PKI) → 단계 2 (공공 PKI) 전환을 명시. **모든 PKI/OCSP endpoint 와 인증 정보를 환경변수**로 분리하면 단계 2 도래 시 코드 변경 0, `.env` swap + restart 만으로 끝.

핵심 env 8개:
- `PKI_BASE_URL` / `OCSP_BASE_URL` / `PKI_API_ID` / `PKI_API_KEY`
- `PNC_ENABLED_DEFAULT` / `PNC_TRIGGER_RENEWAL_DAYS`
- `PNC_PKI_TIMEOUT_MS` / `PNC_OCSP_TIMEOUT_MS`

`PKI_API_KEY` 만 미설정 시 자동으로 비활성 (mock 모드) — 개발 환경에서 외부 의존성 없이 코드 작성 가능.

### 2.3 SignCertificate 는 비동기 파이프라인

스펙 §4.2 는 30초 이내 응답을 요구. PKI 호출이 늦으면 timeout. 따라서:

1. CSR 받자마자 **즉시 OCPP `Accepted` 응답**
2. 비동기로 PKI 호출 → leaf 받으면
3. `CertificateSigned.req` 를 CP 에 송신
4. CP 가 Accepted 회신하면 완료

이 흐름을 추적하기 위해 **`pnc_csr_in_progress` 테이블**에 status 머신을 둠: `pending → signed → delivered`, 또는 `rejected/failed`. 같은 CSR 재제출 시 `csrSha256` unique 키로 idempotent 보장.

### 2.4 OCSP relay = 의존성 0 + 직접 ASN.1 인코딩

`node-forge` (5MB) 도입 검토했으나 **OCSP request 는 RFC 6960 §4.1 의 단순 구조** (SEQUENCE 4단 nest + INTEGER + OCTET STRING ×2 + OID) 라 직접 ASN.1 DER 인코딩 ~100줄로 충분. 패키지 사이즈·보안 표면·npm audit 부담 모두 회피.

핵심 헬퍼: `src/utils/asn1.ts` (130줄) + `src/utils/ocspRequest.ts` (~70줄).

### 2.5 모든 PnC 이벤트 audit = `pnc_audit_log` 단일 테이블

스펙 §9 는 8개 이벤트 카테고리 보존을 요구. **append-only 단일 테이블 + `eventType` enum** 으로 단순화. station 삭제 시에도 보존되도록 FK 미연결 (단순 string 컬럼). DB 실패는 비즈니스 흐름 차단 X (감사 로그 손실은 운영 알람 대상).

12개 이벤트 타입:
- `PnC_Authorize`, `PnC_SignCertificate`, `PnC_CertificateSigned`, `PnC_InstallCertificate`, `PnC_DeleteCertificate`, `PnC_GetInstalledCertIds`, `PnC_TriggerMessage`, `PnC_Get15118EVCertificate`, `PnC_GetCertificateStatus`, `PnC_ConfigChange`, `PnC_ExpiryTrigger`, `PnC_PKI_Call`

---

## 3. 전체 작업 분해 — 7개 PR 의 의존성 그래프

```
                                    main
                                      │
                              ┌───────┴──────────┐
                              │                  │
                       Phase A-1 인프라      (다른 작업 영향 X)
                              │
              ┌───────────────┼──────────────────┐
              │               │                  │
       Phase A-2 PKI 클라이언트   Phase A-3 송신 5종    (병렬 가능)
              │               │
              └───────┬───────┘
                      │
              ┌───────┴───────┐
              │               │
       Phase A-4 config sync   Phase B-1 핸들러 4개
       (A-3 sendChangeConfig    (A-2 PKI, A-3 CertificateSigned 활용)
        활용)                          │
                                       ▼
                                Phase A-5 OCSP relay
                                (B-1 의 stub 제거)
                                       │
                                       ▼
                                Phase B-2 모니터링 + UI
                                (B-1 의 PncCsrInProgress + 5개 송신 활용)
```

PR 마다 작업량 추정:

| PR | 작업량 | 핵심 산출물 |
|---|---|---|
| A-1 infra | S (반나절) | env + 3 model + 마이그레이션 + audit 서비스 |
| A-2 PKI client | M (1~2일) | REST 클라이언트 + 헬스 라우트 |
| A-3 송신 5종 | M (1일) | wrapped sender 헬퍼 + 5 export |
| A-4 config sync | S (반나절) | sync 서비스 + cooldown + BootNotification hook |
| B-1 4 handler | L (2~3일) | 4 sub-handler + registry 등록 + SignCertificate 비동기 파이프라인 |
| A-5 OCSP relay | M (1~2일) | ASN.1 헬퍼 + OCSP builder + relay 서비스 |
| B-2 모니터링 + UI | L (2~3일) | scheduler + 운영자 API 6종 + CS 포털 4 탭 |

**총 추정 7~10 영업일** (단일 개발자 풀타임, Pvpentech 환경 기준).

---

## 4. Phase A-1 — 인프라 (env / DB 스키마 / audit)

### 4.1 목표

이후 PR 들이 의존하는 환경변수, DB 테이블, audit 서비스를 미리 깔아둔다. **운영 영향 0** — 새 테이블만 추가, 컬럼 변경 X.

### 4.2 환경변수 추가 (`src/config/env.ts`)

zod 스키마에 8개 추가:

```ts
PKI_BASE_URL: z.string().default('https://pvpentech.co.kr/pki/15118-2'),
OCSP_BASE_URL: z.string().default('https://pvpentech.co.kr/ocsp'),
PKI_API_ID: z.string().default('gre-csms-2026'),
PKI_API_KEY: z.string().optional(),   // ⚠ optional — mock 모드 허용
PNC_ENABLED_DEFAULT: z.string().transform((v) => v === 'true' || v === '1').default('true'),
PNC_TRIGGER_RENEWAL_DAYS: z.coerce.number().default(30),
PNC_PKI_TIMEOUT_MS: z.coerce.number().default(15000),
PNC_OCSP_TIMEOUT_MS: z.coerce.number().default(8000),
```

### 4.3 PnC 공통 상수 (`src/config/pnc.ts`)

```ts
export const PNC_VENDOR_ID = 'org.openchargealliance.iso15118pnc' as const;

export type PncMessageId =
  | 'Authorize' | 'SignCertificate' | 'Get15118EVCertificate' | 'GetCertificateStatus'
  | 'CertificateSigned' | 'InstallCertificate' | 'DeleteCertificate'
  | 'GetInstalledCertificateIds' | 'TriggerMessage';

export const PNC_CONFIG_KEYS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'ISO15118PnCEnabled',               value: String(env.PNC_ENABLED_DEFAULT) },
  { key: 'ContractValidationOffline',        value: 'true' },
  { key: 'CentralContractValidationAllowed', value: 'true' },
  { key: 'CertSigningWaitMinimum',           value: '30' },
  { key: 'CertSigningRepeatTimes',           value: '3' },
];

export function isPkiEnabled(): boolean {
  return !!env.PKI_API_KEY && env.PKI_API_KEY.length > 0;
}
```

`isPkiEnabled()` 가 핵심 — 키 미설정 시 모든 PKI 호출이 `PkiDisabledError` 로 깔끔히 거부됨.

### 4.4 Prisma 모델 3개

#### `PncInstalledCertificate` — 충전기별 cert 인벤토리

```prisma
model PncInstalledCertificate {
  id              Int      @id @default(autoincrement())
  stationId       String   @db.VarChar(50)
  certificateType String   @db.VarChar(50)        // V2GRootCertificate | EVSELeaf | ...
  serialNumber    String   @db.VarChar(255)
  issuerNameHash  String   @db.VarChar(255)
  issuerKeyHash   String   @db.VarChar(255)
  hashAlgorithm   String   @db.VarChar(20)
  pemBody         String?  @db.Text
  notBefore       DateTime
  notAfter        DateTime
  installedAt     DateTime @default(now())
  revokedAt       DateTime?

  station         ChargingStation @relation(fields: [stationId], references: [id], onDelete: Cascade)

  @@unique([stationId, serialNumber])
  @@index([notAfter])           // 만료 모니터링용
  @@index([revokedAt])
  @@map("pnc_installed_certificate")
}
```

핵심: `notAfter` 인덱스 — 만료 모니터링 cron 의 핵심 쿼리.

#### `PncCsrInProgress` — SignCertificate idempotency

```prisma
model PncCsrInProgress {
  id                Int            @id @default(autoincrement())
  messageId         String         @unique @db.VarChar(50)
  stationId         String         @db.VarChar(50)
  csrPem            String         @db.Text
  csrSha256         String         @db.VarChar(64)
  status            PncCsrStatus   @default(pending)
  evseIdFromSan     String?        @db.VarChar(100)
  leafCertSerial    String?        @db.VarChar(255)
  leafCertPem       String?        @db.Text
  certChainPem      String?        @db.Text
  pkiErrorCode      String?        @db.VarChar(100)
  pkiErrorMessage   String?        @db.VarChar(500)
  requestedAt       DateTime       @default(now())
  pkiCompletedAt    DateTime?
  deliveredAt       DateTime?

  station           ChargingStation @relation(fields: [stationId], references: [id], onDelete: Cascade)

  @@unique([stationId, csrSha256])   // ⚠ idempotency 핵심
  @@index([status, requestedAt])
  @@map("pnc_csr_in_progress")
}

enum PncCsrStatus {
  pending      // PKI 요청 전/대기
  signed       // PKI 가 leaf 반환
  delivered    // CertificateSigned 송신 후 CP Accepted
  rejected     // CP 또는 PKI 가 거부
  failed       // 예외
}
```

`(stationId, csrSha256)` unique 가 핵심. 같은 CSR 재제출 시 캐시된 결과 재반환 — 스펙 §4.2 의 idempotency 요구를 DB 레벨에서 강제.

#### `PncAuditLog` — append-only

```prisma
model PncAuditLog {
  id              BigInt   @id @default(autoincrement())
  eventType       String   @db.VarChar(50)
  stationId       String?  @db.VarChar(50)         // FK 없음 — station 삭제돼도 보존
  eMaid           String?  @db.VarChar(100)
  certSerial      String?  @db.VarChar(255)
  ocppMessageId   String?  @db.VarChar(50)
  status          String?  @db.VarChar(50)
  details         Json?
  occurredAt      DateTime @default(now())

  @@index([eventType, occurredAt])
  @@index([stationId, occurredAt])
  @@index([occurredAt])
  @@map("pnc_audit_log")
}
```

`BigInt` PK 와 `Json` details — 향후 이벤트 카테고리·필드 확장 시 스키마 변경 없이 details 에 추가.

### 4.5 마이그레이션 SQL — 멱등 패턴

```sql
DO $$ BEGIN
  CREATE TYPE "PncCsrStatus" AS ENUM ('pending','signed','delivered','rejected','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "pnc_installed_certificate" ( ... );

DO $$ BEGIN
  ALTER TABLE ... ADD CONSTRAINT "..." FOREIGN KEY (...) ...;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS ...;
```

**모든 DDL 을 멱등화** — 운영 환경 여러 군데 적용 + 롤백·재실행 안전.

### 4.6 Audit 서비스 (`src/services/pncAuditLog.service.ts`)

```ts
export type PncEventType = 'PnC_Authorize' | 'PnC_SignCertificate' | ... ; // 12종

class PncAuditLogService {
  async record(entry: PncAuditEntry): Promise<void> {
    try {
      await prisma.pncAuditLog.create({ data: { ... } });
    } catch (err) {
      // ⚠ DB 실패는 비즈니스 흐름 차단 X — 로그만
      logger.warn({ eventType: entry.eventType, err }, 'PncAuditLog: persist failed');
    }
  }

  async list(params) { /* 운영자 UI 후행 조회 */ }
}
```

핵심: **`record()` 가 throw 하지 않음**. PnC 동작 자체는 audit 와 무관하게 계속 진행. 감사 로그 손실은 운영 알람 대상이지 비즈니스 차단 사유가 아님.

### 4.7 server.ts 부팅 로그

```ts
import { logPncConfigOnce } from '@config/pnc';
// bootstrap 끝:
logPncConfigOnce();
```

운영자가 부팅 즉시 PnC 활성화 여부 / endpoint 를 한눈에 확인.

---

## 5. Phase A-2 — 사내 PKI REST 클라이언트

### 5.1 목표

`pvpentech.co.kr` 의 3개 endpoint 와 health 를 호출하는 클라이언트 모듈. **OCPP 흐름과 격리** — 외부 호출 검증을 먼저 끝낸다.

### 5.2 인증 패턴

스펙 §10.1:
- `X-Open-Api-Id` — 정적 (env)
- `X-Open-Api-Key` — 동적 (env). **로깅 안전** — 헤더만 생성 시점에 주입, 응답·에러 본문에 누출 금지.

### 5.3 호출 envelope 패턴

PKI 가 다음 형식을 강제:

```json
{
  "header": { "traceId": "<UUID>", "timestamp": "<ISO 8601>" },
  "body":   { /* 실제 요청 */ }
}
```

응답도 동일:
```json
{
  "header": { ... },
  "body":   { resultCode: "OK"|"Error_*", resultMsg, ...실제 응답 }
}
```

이걸 매번 손으로 래핑하지 않도록 `call()` 공통 헬퍼:

```ts
private async call<T extends PkiResultBody>(
  method: 'POST' | 'DELETE',
  path: string,
  bodyParams: Record<string, unknown>,
  options: CallOptions,
  operation: string,
): Promise<T> {
  if (!isPkiEnabled()) throw new PkiDisabledError();

  const traceId = randomUUID();
  const payload = { header: { traceId, timestamp: new Date().toISOString() }, body: bodyParams };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), env.PNC_PKI_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, { method, headers: this.buildHeaders(), body: JSON.stringify(payload), signal: controller.signal });
    // 401 → PKI_AUTH_FAILED / 4xx5xx → PKI_HTTP_ERROR
    // resultCode != 'OK' → PKI_BUSINESS_ERROR (resultCode/resultMsg 보존)
    // 모든 단계 audit (PnC_PKI_Call)
  } catch (err) { /* timeout / network */ }
  finally { clearTimeout(timeoutHandle); }
}
```

### 5.4 5단계 에러 분류

| 코드 | 의미 |
|---|---|
| `PKI_DISABLED` | env.PKI_API_KEY 없음 (mock 모드) |
| `PKI_AUTH_FAILED` | HTTP 401 — API key 폐기/회전 필요 |
| `PKI_HTTP_ERROR` | 4xx/5xx (401 외) |
| `PKI_BUSINESS_ERROR` | HTTP 200 + resultCode != 'OK' (예: Error_InvalidCSR) |
| `PKI_TIMEOUT` / `PKI_NETWORK_ERROR` | AbortController / 네트워크 예외 |

### 5.5 3 endpoint 시그니처

```ts
class PncPkiClient {
  async health(): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }>
  async signEvseLeafCert(params: { csr: string; validity? }, options): Promise<SignEvseLeafBody>
  async revokeEvseLeafCert(params: { evseId, certificateId, reason }, options): Promise<RevokeEvseLeafBody>
  async inquiryContractCert(params: { pcid, moId, exi? }, options): Promise<ContractCertBody>
}
```

### 5.6 운영자 헬스 라우트

```ts
// GET /api/portal/cs/pnc/health
router.get('/health', async (_req, res) => {
  const health = await pncPki.health();
  res.json({ success: true, data: { csms: { ...env 요약 }, pkiHealth: health } });
});
```

배포 직후 운영자가 즉시 pvpentech.co.kr 연결성 검증 가능 — 후속 PR 의존성 검증 핵심.

---

## 6. Phase A-3 — CSMS→CP 송신 5종 (wrapped DataTransfer)

### 6.1 핵심 헬퍼

매 송신마다 wrap/unwrap 을 반복하지 않도록 공통 헬퍼 1개:

```ts
async function sendPncWrapped<TInner>(
  stationId: string,
  pncMessageId: PncMessageId,
  innerBody: object,
  options: PncSendOptions,
): Promise<{ outerStatus; inner?: TInner }> {
  // 1) 기존 sendCommand (Phase 3 응답 영속화 자동 적용) 호출
  const outer = await sendCommand<DataTransferOuterResponse>(stationId, 'DataTransfer', {
    vendorId: PNC_VENDOR_ID,
    messageId: pncMessageId,
    data: JSON.stringify(innerBody),     // ⚠ string
  }, { requestedBy: options.requestedBy });

  // 2) outer.data (string) → JSON.parse → inner conf body
  let inner: TInner | undefined;
  if (outer.status === 'Accepted' && outer.data) {
    try { inner = JSON.parse(outer.data); } catch { /* warn */ }
  }

  // 3) PnC 감사 자동 기록
  await pncAuditLog.record({
    eventType: options.auditEvent,
    stationId,
    status: outer.status,
    details: { pncMessageId, ...options.auditDetails, innerStatus: (inner as any)?.status },
  });

  return { outerStatus: outer.status, inner };
}
```

이 헬퍼가 있으면 개별 5개 송신은 5~20줄로 끝:

```ts
export async function sendCertificateSigned(
  stationId: string,
  params: { certificateChain: string },
  requestedBy?: string,
): Promise<CertificateSignedResponse> {
  const res = await sendPncWrapped<CertificateSignedResponse>(
    stationId, 'CertificateSigned', params,
    { requestedBy, auditEvent: 'PnC_CertificateSigned',
      auditDetails: { chainLength: params.certificateChain.length } },
  );
  return res.inner ?? { status: 'Rejected' };
}
```

### 6.2 강타입 응답 fallback

`outer.status !== 'Accepted'` 또는 `inner` 파싱 실패 시 안전한 fallback 응답 (e.g., `{ status: 'Rejected' }`, `{ status: 'Failed' }`). caller 가 항상 `Promise<TResponse>` 받도록.

### 6.3 5종 export

| 함수 | 스펙 | 핵심 |
|---|---|---|
| `sendCertificateSigned` | §5.1 | certChain string |
| `sendInstallCertificate` | §5.2 | V2GRoot / MORoot 푸시 |
| `sendDeleteCertificate` | §5.3 | hash 4필드로 식별 |
| `sendGetInstalledCertificateIds` | §5.4 | 응답에 chain 목록 |
| `sendPncTriggerMessage` | §5.5 | 본문 `{}` |

---

## 7. Phase A-4 — BootNotification 직후 PnC config 자동 sync

### 7.1 핵심 설계

매 BootNotification 마다 5개 ChangeConfiguration 호출하면 폭주. 인메모리 cooldown 24h 적용. 서버 재시작 시 cooldown 초기화 (배포 직후 1회 재동기화 보장).

### 7.2 service 구조

```ts
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const lastSyncedAt = new Map<string, number>();

export async function syncPncConfig(stationId: string, options): Promise<PncConfigSyncResult> {
  // cooldown 체크
  const last = lastSyncedAt.get(stationId);
  if (!options.force && last && Date.now() - last < COOLDOWN_MS) {
    return { stationId, skipped: true, applied: 0, failed: 0, results: [] };
  }

  // 미연결 즉시 skip + audit
  if (!connectionManager.isConnected(stationId)) {
    await pncAuditLog.record({ eventType: 'PnC_ConfigChange', status: 'skipped', ... });
    return { ... };
  }

  // 5개 키 순차 ChangeConfiguration + 각 결과 audit
  for (const { key, value } of PNC_CONFIG_KEYS) {
    try {
      const resp = await sendChangeConfiguration(stationId, { key, value }, requestedBy);
      // status: Accepted | Rejected | RebootRequired | NotSupported
    } catch (err) { /* audit error */ }
  }

  lastSyncedAt.set(stationId, Date.now());
}
```

### 7.3 BootNotification hook

```ts
// bootNotification.handler.ts 응답 반환 직전
setImmediate(() => {
  setTimeout(() => {
    void syncPncConfig(stationId).catch(...);
  }, 200);  // WebSocket 안정화 짧은 지연
});
```

`setImmediate` + 200ms 지연 — BootNotification 응답을 차단하지 않으면서 WebSocket 안정화 후 호출.

### 7.4 운영자 수동 트리거

```ts
// POST /api/portal/cs/pnc/sync-config/:stationId?force=true
// DELETE /api/portal/cs/pnc/sync-config/:stationId/cooldown
```

운영 진단 시 24h 대기 회피.

---

## 8. Phase B-1 — CP→CSMS 4 handler

### 8.1 핸들러 시그니처 (registry 패턴)

```ts
export type DataTransferSubHandler = (
  stationId: string,
  data: string | undefined,           // ⚠ JSON string
) => Promise<DataTransferResponse> | DataTransferResponse;

interface DataTransferResponse {
  status: 'Accepted' | 'Rejected' | 'UnknownMessageId' | 'UnknownVendorId';
  data?: string;                      // ⚠ JSON string (inner conf body)
}
```

각 핸들러는:
1. `data` parse → inner request body
2. 처리
3. inner conf body 생성 → JSON.stringify → return `{ status: 'Accepted', data: '<stringified>' }`

### 8.2 Authorize 핸들러 (§4.1) 처리 흐름

```
1. eMAID DB 조회 (기존 IdToken 테이블 재사용, type=eMAID)
   → idTokenStatus 매핑: Accepted | Blocked | Expired | Invalid | ConcurrentTx
   → certificateStatus 동시 결정

2. iso15118CertificateHashData 가 있으면 각 항목 OCSP relay 호출
   → 실패 시 certificateStatus='NoCertificateAvailable' 다운그레이드

3. 응답 inner body:
   {
     certificateStatus: ...,
     idTokenInfo: { status, cacheExpiryDateTime? }
   }
```

핵심: **OCSP 검증은 별도 모듈** (`pncOcsp.query`) — Phase A-5 의존이지만 핸들러는 미리 호출 부위만 비워두고 B-1 머지, A-5 머지 후 stub 제거 패턴 가능.

### 8.3 SignCertificate 핸들러 (§4.2) — 비동기 파이프라인

가장 복잡한 핸들러. 단계별로:

```
1. CSR PEM 검증 ('-----BEGIN CERTIFICATE REQUEST-----' prefix)
2. csrSha256 계산
3. PncCsrInProgress 조회:
   - 같은 csrSha256 + status='delivered' → 즉시 Accepted (idempotent)
   - status='signed' → CertificateSigned 재송신 (CP 못 받은 가능성)
   - status='pending' → 즉시 Accepted (이미 PKI 호출 중)
   - 신규/rejected/failed → 신규 진행
4. PncCsrInProgress upsert (status=pending)
5. 즉시 OCPP Accepted 응답 ⚠ 스펙 §4.2 30초 timeout 회피
6. void processSignCertificateAsync(stationId, progressId, csr) 비동기 파이프라인 발사
```

비동기 파이프라인:

```ts
async function processSignCertificateAsync(stationId, progressId, csr) {
  try {
    // PKI 호출
    const result = await pncPki.signEvseLeafCert({ csr }, { stationId });
    // PncCsrInProgress UPDATE (status=signed, leafCert/chain)
    await prisma.pncCsrInProgress.update({ ... });
  } catch (err) {
    // status=failed
    await prisma.pncCsrInProgress.update({ ... });
    return;
  }

  // CertificateSigned 송신
  try {
    const resp = await sendCertificateSigned(stationId, { certificateChain: chainPem });
    if (resp.status === 'Accepted') {
      // status=delivered
    } else {
      // status=rejected + 즉시 PKI revoke (스펙 §5.1)
      await pncPki.revokeEvseLeafCert({ evseId, certificateId: leafSerial, reason: 'CP rejected' });
    }
  } catch (err) { /* status=failed */ }
}
```

### 8.4 Get15118EVCertificate 핸들러 (§4.3) — EXI 패스스루

```ts
// inner body: { iso15118SchemaVersion, action: 'Install'|'Update', exiRequest: <base64> }
// 처리: pncPki.inquiryContractCert(pcid=stationId, moId='GRE', exi=exiRequest)
// 응답: { status: 'Accepted', exiResponse: <PKI 응답.exi> }
```

⚠ **EXI 는 변형 금지** — 서명 포함이라 어떤 변환도 EV 가 거부. 단순 pass-through.

단계 1: pcid/moId 는 EXI 안에 있으므로 평문 파싱 없이는 추출 어려움. `stationId` 를 pcid 로 매핑 + `moId='GRE'` 고정. 단계 2 도래 시 정리.

### 8.5 GetCertificateStatus 핸들러 (§4.4) — OCSP relay

A-5 머지 전엔 stub (`status: 'Failed'` + audit 메타 보존). A-5 머지 후 `pncOcsp.query()` 호출로 교체.

### 8.6 등록 진입점

```ts
// src/ocpp/handlers/pnc/index.ts
let registered = false;
export function registerPncHandlers(): void {
  if (registered) return;
  registered = true;
  dataTransferRegistry.register(PNC_VENDOR_ID, 'Authorize', pncAuthorizeHandler);
  dataTransferRegistry.register(PNC_VENDOR_ID, 'SignCertificate', pncSignCertificateHandler);
  dataTransferRegistry.register(PNC_VENDOR_ID, 'Get15118EVCertificate', pncGet15118EvCertificateHandler);
  dataTransferRegistry.register(PNC_VENDOR_ID, 'GetCertificateStatus', pncGetCertificateStatusHandler);
}

// server.ts bootstrap:
registerPncHandlers();
```

---

## 9. Phase A-5 — OCSP relay (RFC 6960 / 의존성 0)

### 9.1 ASN.1 DER 인코딩 (`src/utils/asn1.ts`)

최소 헬퍼 — 외부 라이브러리 안 씀:

```ts
export function encodeLength(len: number): Buffer { /* short/long form */ }
export function encodeTLV(tag: number, value: Buffer): Buffer { /* tag + length + value */ }

export function asn1Sequence(...children: Buffer[]): Buffer
export function asn1OctetString(value: Buffer): Buffer
export function asn1Integer(value: string | number | Buffer): Buffer  // hex string 직접 받음
export function asn1Oid(dotted: string): Buffer                       // base-128 인코딩
export function asn1Null(): Buffer

export const HASH_OID = {
  SHA1: '1.3.14.3.2.26',
  SHA256: '2.16.840.1.101.3.4.2.1',
  SHA384: '2.16.840.1.101.3.4.2.2',
  SHA512: '2.16.840.1.101.3.4.2.3',
};
```

**주의점**:
- `asn1Integer`: DER 표준 → big-endian, signed. 양수인데 MSB=1 이면 leading 0x00 추가. leading zero 는 strip (최소 인코딩).
- `asn1Oid`: 첫 두 노드 `(a*40+b)` 한 바이트, 나머지 base-128 (high bit continuation).
- `encodeLength`: ≤127 = 1바이트, 그 외 long form `0x80 | N` + big-endian.

### 9.2 OCSP request builder (`src/utils/ocspRequest.ts`)

```ts
export interface CertIdInput {
  hashAlgorithm: 'SHA1' | 'SHA256' | ...;
  issuerNameHash: string;      // hex
  issuerKeyHash: string;       // hex
  serialNumber: string;        // hex
}

function buildCertID(input: CertIdInput): Buffer {
  return asn1Sequence(
    algorithmIdentifier(HASH_OID[input.hashAlgorithm]),  // parameters=NULL
    asn1OctetString(hexToBuffer(input.issuerNameHash)),
    asn1OctetString(hexToBuffer(input.issuerKeyHash)),
    asn1Integer(input.serialNumber),
  );
}

export function buildOcspRequest(certIds: CertIdInput[]): Buffer {
  const requestList = asn1Sequence(...certIds.map(cid => asn1Sequence(buildCertID(cid))));
  const tbsRequest = asn1Sequence(requestList);
  return asn1Sequence(tbsRequest);
}
```

`version` / `requestorName` / `extensions` 모두 default 또는 absent — 가장 호환성 높음. 서명 미포함 (스펙 §6.4 의 단순 패스스루 요구).

### 9.3 Relay 서비스 (`src/services/pncOcsp.service.ts`)

```ts
class PncOcspRelay {
  async query(input: OcspRelayInput, audit: OcspAuditOptions): Promise<OcspRelayResult> {
    // 1) buildOcspRequest → DER Buffer
    const derRequest = buildOcspRequest([this.toCertId(input)]);

    // 2) POST responderURL
    const res = await fetch(input.responderURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ocsp-request', Accept: 'application/ocsp-response' },
      body: new Uint8Array(derRequest),       // ⚠ Node 18+ fetch 가 Uint8Array body 받음
      signal: controller.signal,
    });

    // 3) DER 응답 → base64
    const buf = Buffer.from(await res.arrayBuffer());
    const ocspResultBase64 = buf.toString('base64');

    // 4) audit (PnC_GetCertificateStatus 또는 PnC_Authorize)
    return { ok: true, httpStatus, ocspResultBase64 };
  }
}
```

### 9.4 B-1 stub 제거

`getCertificateStatus.handler.ts` 의 `status: 'Failed'` stub 을 `pncOcsp.query()` 호출로 교체. `authorize.handler.ts` 의 OCSP 검증 분기도 동일 패턴.

---

## 10. Phase B-2 — 만료 모니터링 + UI

### 10.1 모니터링 서비스 (`src/services/pncCertExpiry.service.ts`)

```ts
class PncCertExpiryService {
  async scanAndTrigger({ dryRun, requestedBy }) {
    const renewalDays = env.PNC_TRIGGER_RENEWAL_DAYS;
    const now = new Date();
    const upperBound = new Date(now.getTime() + 60 * 24 * 3600 * 1000); // 60일

    const certs = await prisma.pncInstalledCertificate.findMany({
      where: {
        certificateType: 'EVSELeaf',
        revokedAt: null,
        notAfter: { lte: upperBound },
      },
      orderBy: { notAfter: 'asc' },
    });

    const triggeredStations = new Set<string>();
    for (const cert of certs) {
      const daysLeft = Math.floor((cert.notAfter.getTime() - now.getTime()) / (24 * 3600 * 1000));
      // 분류: info(>renewalDays) / renew / critical(<=7) / expired(<0)
      // renew/critical/expired 면 sendPncTriggerMessage (stationId당 1회)
      // 오프라인이면 audit 에 skipped
    }
  }

  async manualTrigger(stationId, requestedBy) { /* UI 호출 */ }
  async listInventory({...filters}) { /* UI 조회 */ }
  async listCsrProgress({...filters}) { /* UI 조회 */ }
}
```

### 10.2 Scheduler (`src/jobs/schedulers/pncCertExpiry.scheduler.ts`)

```ts
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5 * 60 * 1000;

let dailyTimer: NodeJS.Timeout | null = null;

export function startPncCertExpiryScheduler(): void {
  if (dailyTimer) return;
  const run = async () => { await pncCertExpiry.scanAndTrigger(); };
  setTimeout(run, STARTUP_DELAY_MS).unref();   // 부팅 5분 후 첫 실행
  dailyTimer = setInterval(run, ONE_DAY_MS);
  dailyTimer.unref();
}
```

`unref()` — Node 가 이 타이머 때문에 셔트다운 지연 안 함.

### 10.3 운영자 REST API (확장 6개)

```
GET  /api/portal/cs/pnc/certificates
GET  /api/portal/cs/pnc/csr-progress
GET  /api/portal/cs/pnc/audit
POST /api/portal/cs/pnc/trigger/:stationId
POST /api/portal/cs/pnc/expiry-scan?dryRun=
POST /api/portal/cs/pnc/install-root/:stationId
POST /api/portal/cs/pnc/list-certs/:stationId
POST /api/portal/cs/pnc/delete-cert/:stationId
```

### 10.4 CS 포털 UI 4 탭

`public/portal/cs/index.html` (vanilla JS 구조) 에 추가:

1. **개요**: PKI 헬스 + CSMS 설정 + "만료 스캔 실행" 모달 (dryRun)
2. **인증서 인벤토리**: 만료일 색상 코딩 (빨강 ≤7일 / 주황 ≤30일 / 초록 안전) + 각 row "TriggerMessage" 버튼
3. **CSR 진행**: status 색상 + 오류 메시지
4. **감사 로그**: 12 이벤트 타입 색상 + details JSON 미리보기

기존 manufacturer / firmware 화면과 동일한 패턴 (`loadPnc()` / 탭 전환 / `renderPncXxx()`).

---

## 11. 외부 인프라 가정 / CSMS 외부 의존성

### 11.1 사내 V2G PKI 인프라 (별도 팀)

다음을 운영팀이 미리 구축해야 함:

- **REST API endpoint**: `https://pvpentech.co.kr/pki/15118-2/`
  - `POST cpo/cpora/evse-leaf-cert` (CSR 서명)
  - `DELETE cpo/cpova/evse-leaf-cert/revoke`
  - `POST cpo/ccp/contract-cert` (mock CCP)
- **OCSP responder**: `https://pvpentech.co.kr/ocsp/{cpo|oem|mo|cps}`
- **헬스**: `GET /pki-health` (인증 불필요)
- **API key 발급 채널**: `pvpentech.co.kr:/home/pki/pki-wrapper/api-key.env`
- **요청·응답 envelope**: `{ header: { traceId, timestamp }, body: {...} }` 표준화

### 11.2 충전기(CP) 측 가정

- **PnC 7개 OCPP config 키 인식** (`ISO15118PnCEnabled` 외) — 펌웨어가 모르면 `NotSupported` 응답
- **wrapped DataTransfer** 수신·송신 가능 — `vendorId="org.openchargealliance.iso15118pnc"` 알아야 함
- **ECDSA P-256 CSR 생성** — secp256r1 키 페어 + SAN URI `urn:evseid:<STATION>`
- **`TriggerMessage(SignChargePointCertificate)`** 응답 시 새 CSR 자율 송신

### 11.3 EV(EVCC) 측 — CSMS 와 직접 통신 없음

- ISO 15118-2 TLS 1.2 + EXI + ECDSA secp256r1
- CertificateInstallation/Update EXI 를 CP 가 전달 → CSMS 가 mock CCP 로 패스스루
- OCSP 응답 자체의 `good/revoked/unknown` 파싱은 EV 가 함

---

## 12. 검증 절차 (단계별)

각 PR 머지·배포 후 즉시 확인할 항목:

### 12.1 A-1 머지 후

```bash
# 마이그레이션 적용 확인
sudo -u postgres psql pvpentech -c "\dt pnc_*"

# 부팅 로그
pm2 logs pvpentech-csms --lines 30 | grep -i 'pnc'
# 기대: "ISO 15118 PnC config loaded","pkiEnabled":false (API key 없으면)
```

### 12.2 A-2 머지 후

```bash
# 헬스 라우트
curl -H "Authorization: Bearer $CS_JWT" \
  https://csms.pvpentech.com/api/portal/cs/pnc/health | jq

# 기대: pkiHealth.ok=true (API key 있으면), false (없으면)
```

### 12.3 A-3 머지 후

직접 호출 (REPL):
```bash
node -e "
require('module-alias/register'); require('dotenv').config();
const { sendPncTriggerMessage } = require('./dist/ocpp/commands');
sendPncTriggerMessage('EN900001', 'admin').then(r => console.log(JSON.stringify(r)));
"
# 기대: {status:'Accepted'} (시뮬레이터가 알면)
```

### 12.4 A-4 머지 후

```bash
# 강제 sync
curl -X POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/sync-config/EN900001?force=true" | jq

# 기대: applied=5 또는 failed=N (충전기가 미지원이면)
```

### 12.5 B-1 머지 후

시뮬레이터 Phase 1 가 시작되면 CP→CSMS PnC 메시지가 들어옴. 그 전엔 REPL 로 핸들러 직접 호출:

```bash
node -e "
require('module-alias/register'); require('dotenv').config();
const { dataTransferRegistry } = require('./dist/ocpp/handlers/dataTransfer.handler');
const handler = dataTransferRegistry.resolve('org.openchargealliance.iso15118pnc', 'Authorize');
handler('EN900001', JSON.stringify({ idToken: 'KRGRE0000000001' }))
  .then(r => console.log(JSON.stringify(r, null, 2)));
"
```

### 12.6 A-5 머지 후

OCSP responder 직접 호출:

```bash
node -e "
require('module-alias/register'); require('dotenv').config();
const { pncOcsp } = require('./dist/services/pncOcsp.service');
pncOcsp.query({
  hashAlgorithm: 'SHA256',
  issuerNameHash: '4D9A020000C6483D' + 'A'.repeat(48),
  issuerKeyHash:  '9EF251CF53894DD3' + 'B'.repeat(48),
  serialNumber:   '2EC72CE6CB99C01D',
  responderURL:   'https://pvpentech.co.kr/ocsp/mo',
}, {}).then(r => console.log(JSON.stringify(r)));
"
# 기대: ok:true, ocspResultBase64:"MII..." (응답 DER)
```

### 12.7 B-2 머지 후

```bash
# dryRun 스캔
curl -X POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/expiry-scan?dryRun=true" | jq

# 수동 TriggerMessage
curl -X POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/trigger/EN900001" | jq

# audit 확인
curl -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/audit?eventType=PnC_ExpiryTrigger" | jq
```

CS 포털 → "PnC 운영" → 4탭 UI 동작 확인.

---

## 13. 회피한 함정 / 트레이드오프

### 13.1 회피 — node-forge 5MB 의존성

OCSP request 빌드용으로 검토했으나 직접 ASN.1 인코딩 ~200줄로 충분. **npm audit / 패키지 사이즈 / 보안 표면** 모두 회피.

### 13.2 회피 — Authorize 동기 PKI 호출

스펙 §4.2 의 30초 timeout. 동기로 PKI 호출하면 PKI 응답 지연 시 OCPP timeout. **즉시 Accepted 응답 + 비동기 파이프라인 + idempotency DB** 로 해결.

### 13.3 회피 — 매 BootNotification 마다 5개 ChangeConfiguration

폭주 방지를 위해 **인메모리 24h cooldown**. 단 재시작 시 cooldown 초기화 (배포 직후 1회 재동기화 의도). force=true 옵션으로 운영자 즉시 재시도 가능.

### 13.4 트레이드오프 — cert 인벤토리 자동 채움 X (현 단계)

`pnc_installed_certificate` 자동 채움 (SignCertificate 흐름에서 X509 파싱 → INSERT) 은 별도 PR 로 분리. 만료 모니터링 cron 이 의미 있게 동작하려면 인벤토리가 채워져야 함. **현재는 운영자가 수동 또는 GetInstalledCertificateIds 응답으로 채워야 함**.

### 13.5 트레이드오프 — OCSP 응답 파싱 안 함

CSMS 는 단순 transport relay — DER 받은 그대로 base64 인코딩해서 회신. `good/revoked/unknown` 파싱은 EV 측이 함. CSMS 가 파싱하려면 OCSPResponse ASN.1 디코더 필요 → 의존성 또는 ~300줄 코드. 현 단계에선 불필요.

### 13.6 트레이드오프 — pcid/moId 추출 안 함

`Get15118EVCertificate` 의 EXI 안에 pcid 가 있지만 EXI 파싱은 비용이 큼. 단계 1 에선 `stationId=pcid`, `moId='GRE'` 로 매핑. 단계 2 도래 시 EXI 파서 (또는 별도 매핑 테이블) 도입.

### 13.7 트레이드오프 — audit 보존 정책

스펙 §9 의 "3년 보존"은 운영자 책임. CSMS 는 append-only INSERT 만 보장하고 archiving·deletion 정책은 별도 (예: 월 1회 N개월 이전 데이터를 별도 백업 DB 로 이관).

---

## 14. 단계 2 (공공 V2G PKI) 확장 구조

### 14.1 코드 변경 0 보장

PnC 의 모든 외부 endpoint 와 인증 정보가 환경변수에 묶여 있어 단계 2 전환 시:

```bash
# .env 4줄 swap
PKI_BASE_URL=https://pki.ev.or.kr/pki/15118-2
OCSP_BASE_URL=http://ocsp.ev.or.kr
PKI_API_ID=<공공 발급 ID>
PKI_API_KEY=<공공 발급 Key>

pm2 restart pvpentech-csms --update-env
```

### 14.2 보완 가능성

다음은 단계 2 전환 시 검토:

- **VPN dual tunnel**: AXGATE / NEXG 구성 — 인프라팀 작업
- **eMAID 동기화**: 단계 1 의 mock CCP 대신 실제 공공 eMAID 마스터 데이터 동기화. 별도 동기 작업 필요할 가능성.
- **OCSP responder URL 동적 결정**: 충전기 cert 안에 AIA (Authority Information Access) extension 으로 OCSP URL 가 박혀 있음. 충전기가 보내는 `responderURL` 을 그대로 사용하므로 CSMS 코드 변경 없음.
- **공공 발급 EVSE Leaf 인증서 양립**: 사내 V2G Root 로 서명된 leaf + 공공 V2G Root 로 서명된 leaf 가 동시 존재 가능. CP 의 `CertificateStoreMaxLength` (기본 10) 내에서 운영.

---

## 15. 부록 — 파일 목록 / 라인 수 / 라이브러리 결정

### 15.1 PnC 로 추가/수정된 파일 (요약)

| 영역 | 파일 | 라인 (대략) |
|---|---|---|
| env / 상수 | `src/config/env.ts` (+10), `src/config/pnc.ts` | 80 |
| Audit | `src/services/pncAuditLog.service.ts` | 110 |
| PKI client | `src/services/pncPki.service.ts` | 300 |
| OCSP relay | `src/services/pncOcsp.service.ts` | 180 |
| ASN.1 / OCSP builder | `src/utils/asn1.ts`, `src/utils/ocspRequest.ts` | 200 |
| Config sync | `src/services/pncConfig.service.ts` | 115 |
| 만료 모니터링 | `src/services/pncCertExpiry.service.ts`, `src/jobs/schedulers/pncCertExpiry.scheduler.ts` | 230 |
| OCPP 송신 5종 | `src/ocpp/commands/pncSend.command.ts` | 240 |
| OCPP 수신 4 handler | `src/ocpp/handlers/pnc/*.handler.ts` + `index.ts` | 670 |
| REST API | `src/routes/portal/cs/pncOps.routes.ts` | 230 |
| Prisma | `prisma/schema.prisma` (+90), 마이그레이션 1개 (90) | 180 |
| 운영 UI | `public/portal/cs/index.html` (+250) | 250 |
| server bootstrap | `src/server.ts` (+10) | 10 |
| **합계** | | **~2,800줄** |

### 15.2 사용·검토한 외부 라이브러리

| 후보 | 결정 | 사유 |
|---|---|---|
| `node-forge` | ❌ 미채택 | OCSP request 만 필요 — 직접 ASN.1 인코딩으로 충분 (~200줄). 5MB 의존성 회피 |
| `@peculiar/asn1-ocsp` | ❌ 미채택 | 같은 사유 |
| Node 18+ 내장 `fetch` | ✅ 사용 | PKI REST + OCSP POST — Buffer body 직접 처리 가능 |
| Node 내장 `node:crypto` `randomUUID()` `createHash()` `X509Certificate` | ✅ 사용 | UUID, sha256 idempotency 키, leaf serial 추출 |
| Express + Prisma (기존) | ✅ 그대로 | 새 의존성 추가 없음 |

### 15.3 7개 PR 의 commit hash (참조용)

| PR | 머지 commit (main) | 비고 |
|---|---|---|
| A-1 | `56142d4` | 인프라 |
| A-2 | `8f218b3` | PKI 클라이언트 |
| A-3 | (커밋 hash 참조) | 송신 5종 |
| A-4 | `8bdf03e` | config sync |
| B-1 | `83679fb` | 4 handler |
| A-5 | `474c3ac` | OCSP relay |
| B-2 | (이번 PR) | 모니터링 + UI |

### 15.4 후속 작업 (의도적 미수행)

| 항목 | 우선순위 | 작업량 추정 |
|---|---|---|
| `pnc_installed_certificate` 자동 채움 | 중 | M — signCertificate 핸들러 통합 + X509 파싱 |
| 단위 테스트 (asn1, ocspRequest, handlers) | 중 | M — jest 도입 |
| 운영자 가이드 문서 | 중 | S — `outputs/pnc_operator_guide.md` (별도 작성됨) |
| Keysight EVCC 통합 테스트 | 낮음 | L — 시뮬레이터 Phase 5 이후 |
| 단계 2 공공 PKI 전환 | 미정 | S (코드) + 인프라팀 작업 |

---

## 변경 이력

- **2026-05-11**: 초안 작성. Pvpentech CSMS 의 ISO 15118 PnC 구현 7개 PR (A-1~B-2 + UI) 의 작업 절차·코드 구조·설계 결정 정리.

---

## 부록: 참조 문서

- 원본 스펙: `documents/design_guide/csms_pnc_implementation_spec_2026-05-11.md` (902줄)
- 운영자 가이드: `outputs/pnc_operator_guide.md` (구현 완료 후 운영자가 따라할 절차)
- OCA Application Note v1.0 (2020-09-16): "Using ISO 15118 Plug & Charge with OCPP 1.6"
- RFC 6960: Online Certificate Status Protocol (OCSP)
- OCPP 2.0.1 §A·§C·§M
