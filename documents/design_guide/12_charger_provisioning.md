# 12. 충전기 프로비저닝 플로우 설계 가이드

- **버전**: v2.0
- **작성일**: 2026-03-31
- **업데이트**: 2026-05-07 (v2.0 — 인증 방식 x-token/x-channel, Manufacturer 테이블, model 필수화, 응답 코드 체계 갱신)
- **대상**: Node.js 백엔드 개발자
- **참조**: `design_ref/usage_scenario.txt`, `04_database_schema.md`, `03_ocpp_websocket_handler.md`, `outputs/auths_provisioning_revised_design.md`

---

## 변경 이력

| 버전 | 날짜 | 핵심 변경 내용 |
|------|------|--------------|
| v1.0 | 2026-03-31 | Basic Auth 기반 프로비저닝 설계 최초 작성 |
| v1.1 | 2026-04-15 | 키워드 검색, CSV 일괄등록, ChargerConfig, 수정/삭제 API 추가 |
| **v2.0** | **2026-05-07** | 인증 방식 변경(Basic Auth → `x-token`/`x-channel`), Manufacturer 테이블 신규, `model` 필드 필수화, 응답 코드 체계(400/401/404/409/500) 갱신, CS 포털 제조사 관리 API 추가 |

---

## 1. 개요 (Overview)

충전기 프로비저닝(Provisioning)은 새로운 충전기가 현장에 설치될 때 CSMS에 자동으로 등록되고 OCPP 연결 정보를 수령하는 과정입니다.

### 프로비저닝 목적

- 충전기가 공장에서 출고될 때 CSMS 주소를 하드코딩하지 않아도 됨
- 현장 설치 후 시리얼번호(`origin`)만으로 자동 설정 완료
- 등록되지 않은 충전기의 무단 접속 방지
- **v2.0**: 제조사별 독립 인증으로 토큰 유출 영향 범위 최소화

### 충전기 아이디 생성 규칙

- 형식: `"EN"` + 7자리 숫자 (예: `EN1000001`, `EN1000002`)
- 시작 번호: `1000000` (7자리 최솟값)
- 생성 방식: DB 시퀀스 또는 현재 최대값 + 1 조회 (원자적 증가)
- 아이디는 OCPP WebSocket 연결 시 `stationId`(`clientId`)로 사용됨

### v1.x → v2.0 핵심 변경점 요약

| 구분 | v1.x | v2.0 |
|------|------|------|
| 인증 방식 | `Authorization: Basic base64(token)` | `x-token` + `x-channel` 커스텀 헤더 |
| 제조사 구분 | 없음 (단일 토큰) | 제조사별 채널(`x-channel`) 독립 토큰 |
| `model` 필드 | optional | **필수(required)** |
| Manufacturer DB | 없음 | `manufacturer` 테이블 신규 추가 |
| ChargerProvisioning | `manufacturerId` 없음 | `manufacturerId` FK 추가 |
| 엔드포인트 | `POST /provision` | `POST /auths` |
| 응답 형식 | 필드 평면 구조 | `{ code, status, message, timestamp, data }` |
| 404 의미 | 미등록 → 403 반환 | 미등록 또는 채널 불일치 → 404 반환 |
| 409 One-shot | 동일 | 명시적 유지 (재호출 시 409) |

> **v1.x 호환성 노트**: 이미 OCPP 운영 중인 충전기의 WebSocket 접속(Basic Auth 기반)에는 영향이 없습니다. v2.0 변경은 신규 프로비저닝 엔드포인트(`/auths`)에만 적용됩니다.

---

## 2. 프로비저닝 흐름 (시퀀스 다이어그램)

```
충전기 (현장 설치)          Pvpentech 서버                    PostgreSQL
        │                          │                               │
        │  POST /auths              │                               │
        │  x-token: <token>         │                               │
        │  x-channel: vendor_a      │                               │
        │  { origin, model }        │                               │
        ├─────────────────────────►│                               │
        │                          │                               │
        │                          │  [Step 1] x-token/x-channel   │
        │                          │  헤더 검증 (manufacturerAuth)  │
        │                          │── SELECT manufacturer ──────►│
        │                          │   WHERE channelId=vendor_a    │
        │                          │◄─────────────────────────────│
        │                          │  bcrypt.compare(x-token,      │
        │                          │    tokenHash) + isActive 확인  │
        │                          │                               │
        │  [인증 실패 시]            │                               │
        │◄── 401 Unauthorized ─────│                               │
        │                          │                               │
        │                          │  [Step 2] Zod body 검증       │
        │                          │  origin(required), model(req.) │
        │  [검증 실패 시]            │                               │
        │◄── 400 Bad Request ──────│                               │
        │                          │                               │
        │                          │  [Step 3] ChargerProvisioning  │
        │                          │── SELECT WHERE serialNumber ─►│
        │                          │◄─────────────────────────────│
        │                          │                               │
        │  [미등록 / 제조사 불일치]   │                               │
        │◄── 404 Not Found ────────│                               │
        │                          │                               │
        │  [이미 provisioned]       │                               │
        │◄── 409 Conflict ─────────│                               │
        │                          │                               │
        │                          │  [Step 4] clientId 결정       │
        │                          │  (기존 clientId || 신규 생성)   │
        │                          │── UPSERT station_id_seq ────►│
        │                          │◄─────────────────────────────│
        │                          │                               │
        │                          │  [Step 5] 비밀번호 생성        │
        │                          │  generateRandomPassword(32)   │
        │                          │  bcrypt.hash → passwordHash   │
        │                          │                               │
        │                          │  [Step 6] 트랜잭션             │
        │                          │── BEGIN TRANSACTION ─────────►│
        │                          │── UPSERT charging_station ──►│
        │                          │── UPDATE charger_provisioning─►│
        │                          │   status='provisioned'        │
        │                          │── COMMIT ────────────────────►│
        │                          │◄─────────────────────────────│
        │                          │                               │
        │  HTTP 200 OK              │                               │
        │  {                        │                               │
        │    code: 200,             │                               │
        │    data: {                │                               │
        │      clientId: "EN1000001"│                               │
        │      pwd: "...",          │                               │
        │      wsUrl: "wss://..."   │                               │
        │    }                      │                               │
        │  }                        │                               │
        │◄─────────────────────────│                               │
        │                          │                               │
        │  [충전기 내부: clientId,   │                               │
        │   pwd, wsUrl 비휘발성 저장]│                               │
        │                          │                               │
        │  WebSocket 연결 시도       │                               │
        │  wss://.../ocpp/EN1000001 │                               │
        │  Authorization: Basic ... │                               │
        ├───────────────────────────────────────────────────────►  │
        │                          │                               │
        │                          │  OCPP Basic Auth 검증          │
        │                          │  (별도 체계, v2.0 변경 없음)    │
        │  WebSocket Established    │                               │
        │◄──────────────────────────────────────────────────────── │
        │                          │                               │
        │  BootNotification         │                               │
        ├───────────────────────────────────────────────────────►  │
        │  BootNotification Response│                               │
        │◄──────────────────────────────────────────────────────── │
        │  (OCPP 정식 운영 시작)     │                               │
```

---

## 3. 프로비저닝 전용 HTTP 엔드포인트 설계

### 3.1 엔드포인트

```
POST /auths
```

- 인증: `x-token` + `x-channel` 커스텀 헤더 (제조사별 발급)
- Content-Type: `application/json`
- Rate Limiting: IP당 분당 5회, 시간당 20회

### 3.2 Request Headers

| 헤더 이름 | 필수 | 설명 | 예시 |
|----------|------|------|------|
| `x-token` | 필수 | 제조사 인증 토큰 (CS 포털에서 발급된 64자 hex 토큰) | `x-token: a3f9b2c1d4e5f6a7...` |
| `x-channel` | 필수 | 제조사 채널 ID (CS 담당자가 제조사 등록 시 부여) | `x-channel: vendor_a` |
| `Content-Type` | 필수 | 반드시 `application/json` | `Content-Type: application/json` |

> `Authorization` 헤더는 v2.0부터 사용하지 않습니다. `x-token`/`x-channel` 헤더를 누락하면 즉시 401 응답합니다.

### 3.3 Request Body

```typescript
interface AuthsRequestBody {
  origin: string;  // 필수 — 충전기 시리얼번호 (제조사 부여, 1~100자)
  model:  string;  // 필수 — 충전기 모델명 (v2.0부터 required, 1~100자)
}
```

```json
{
  "origin": "CP-VDA-00123",
  "model":  "VDA-7kW-AC01"
}
```

| 필드 | 타입 | 필수 | 설명 | 예시 |
|------|------|------|------|------|
| `origin` | `string` | 필수 | 충전기 시리얼번호. DB의 `charger_provisioning.serial_number`와 매핑. | `"CP-VDA-00123"` |
| `model` | `string` | 필수 | 충전기 모델명. `charging_station.model_name`에 저장. **v2.0부터 optional → required** | `"VDA-7kW-AC01"` |

Zod 검증 스키마:

```typescript
import { z } from 'zod';

export const authsBodySchema = z.object({
  origin: z.string().min(1).max(100),
  model:  z.string().min(1).max(100),   // v2.0: optional → required
});

export type AuthsBody = z.infer<typeof authsBodySchema>;
```

### 3.4 Response — 성공 (HTTP 200)

```typescript
interface AuthsSuccessResponse {
  code:      200;
  status:    'OK';
  message:   string;
  timestamp: string;       // KST "YYYY-MM-DD HH:mm:ss"
  data: {
    clientId: string;      // 발급된 충전기 식별자 (예: "EN1000001")
    pwd:      string;      // OCPP Basic Auth용 평문 비밀번호 (32자 랜덤, 1회만 반환)
    wsUrl:    string;      // OCPP WebSocket 서버 URL
  };
}
```

```json
{
  "code": 200,
  "status": "OK",
  "message": "프로비저닝이 완료되었습니다.",
  "timestamp": "2026-05-07 14:30:00",
  "data": {
    "clientId": "EN1000001",
    "pwd":      "xK9mP2qR7vL4nJ8sT1wY5oU6eA3bC0dF",
    "wsUrl":    "wss://pvpentech.kr"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `code` | `number` | HTTP 상태 코드와 동일 (200) |
| `status` | `string` | 응답 상태 문자열 (`"OK"`) |
| `message` | `string` | 사용자 친화적 메시지 (다국어 대응) |
| `timestamp` | `string` | 서버 처리 완료 시각 — **KST** 기준 `YYYY-MM-DD HH:mm:ss` 형식 |
| `data.clientId` | `string` | 발급된 충전기 식별자. `EN` 접두사 + 7자리 숫자. OCPP 접속 경로에 사용. |
| `data.pwd` | `string` | OCPP Basic Auth 비밀번호 (평문, 32자 랜덤). **이 응답 외에는 복원 불가** — 서버에는 bcrypt 해시만 저장. |
| `data.wsUrl` | `string` | OCPP WebSocket 서버 기본 URL. 충전기는 이 URL에 `/<clientId>` 또는 `/ocpp/<clientId>`를 붙여 접속. |

> **timestamp 형식 주의**: ISO 8601이 아닌 KST `YYYY-MM-DD HH:mm:ss` 형식을 사용합니다. `dayjs().tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')`으로 생성.

### 3.5 Response — 실패

#### 3.5.1 오류 응답 코드 요약표

| HTTP 코드 | 의미 | 주요 발생 원인 |
|----------|------|-------------|
| `400` | 요청 형식 오류 | body 필수 필드 누락(`origin`/`model`), 타입/길이 오류 |
| `401` | 인증 실패 | `x-token`/`x-channel` 누락, 토큰 불일치, 제조사 비활성화, status=`rejected`/`revoked` |
| `404` | 리소스 없음 | 시리얼 미등록, 다른 제조사 채널 시리얼 |
| `409` | 충돌 | 이미 `provisioned` 상태에서 재호출 |
| `500` | 서버 오류 | DB 장애, 예상치 못한 예외 |

> **401 vs 404 구분 원칙**: 401은 **헤더 인증 실패** (제조사 수준 문제), 404는 **시리얼번호 조회 실패** (충전기 수준 문제). 두 오류를 명확히 분리합니다.

#### 400 Bad Request

```json
{
  "code": 400,
  "status": "Bad Request",
  "message": "요청 형식이 올바르지 않습니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": [
    { "field": "model", "message": "model은 필수 항목입니다." }
  ]
}
```

#### 401 Unauthorized

```json
{
  "code": 401,
  "status": "Unauthorized",
  "message": "인증에 실패하였습니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

발생 조건: `x-token` 헤더 없음 / `x-channel` 헤더 없음 / `x-channel`로 Manufacturer 미조회 / bcrypt 불일치 / `isActive=false` / status=`rejected`/`revoked`

#### 404 Not Found

```json
{
  "code": 404,
  "status": "Not Found",
  "message": "등록되지 않은 충전기입니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

발생 조건: `origin`이 DB에 없음 / `ChargerProvisioning.manufacturerId`가 인증된 제조사 ID와 불일치

> **보안 주의**: 404 응답 메시지는 시리얼 미등록인지, 채널 불일치인지를 구분하지 않습니다. 두 경우 모두 동일한 메시지로 시리얼 열거(enumeration) 공격을 차단합니다.

#### 409 Conflict

```json
{
  "code": 409,
  "status": "Conflict",
  "message": "이미 프로비저닝이 완료된 충전기입니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

One-shot 정책: 최초 호출만 200, 이후 재호출은 모두 409. 재설치/공장 초기화 케이스는 CS 포털에서 reset 처리 후 재호출합니다.

#### 500 Internal Server Error

```json
{
  "code": 500,
  "status": "Internal Server Error",
  "message": "서버 내부 오류가 발생하였습니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

---

## 4. DB 테이블 설계 (프로비저닝 상태 관리)

### 4.1 신규 테이블 — `Manufacturer` (v2.0)

```prisma
/// 충전기 제조사 테이블 — v2.0 신규
model Manufacturer {
  id          Int      @id @default(autoincrement())
  channelId   String   @unique @db.VarChar(50)    // x-channel 헤더 값 (CS가 부여)
  name        String   @db.VarChar(100)           // 제조사 이름 (예: "VendorA Co., Ltd.")
  tokenHash   String   @db.VarChar(255)           // bcrypt hash of x-token (평문 미저장)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  provisionings ChargerProvisioning[]

  @@index([channelId])
  @@map("manufacturer")
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | `Int` | PK, auto increment |
| `channelId` | `String(50)` | `x-channel` 헤더 값과 1:1 매핑. CS 담당자가 제조사 등록 시 임의 부여. UNIQUE 인덱스. |
| `name` | `String(100)` | 제조사 법인명 또는 브랜드명 |
| `tokenHash` | `String(255)` | CS 포털 발급 토큰의 bcrypt 해시 (cost factor 12). 평문은 저장하지 않음. |
| `isActive` | `Boolean` | `false`이면 해당 제조사의 모든 `/auths` 요청이 401 응답. 소프트 비활성화. |

### 4.2 `charger_provisioning` 테이블 (v2.0 변경)

```prisma
model ChargerProvisioning {
  id              Int                 @id @default(autoincrement())
  serialNumber    String              @unique @db.VarChar(100)  // 제조사 시리얼번호
  modelName       String?             @db.VarChar(100)          // 충전기 모델명
  clientId        String?             @unique @db.VarChar(50)   // CS 사전 지정 clientId
  stationId       String?             @unique @db.VarChar(50)   // 프로비저닝 후 생성된 "EN" + 7자리
  status          ProvisioningStatus  @default(registered)
  registeredBy    String?             @db.VarChar(150)          // CS 담당자 username
  provisionedAt   DateTime?
  rejectedAt      DateTime?
  rejectReason    String?             @db.VarChar(255)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  // v2.0 신규 추가
  manufacturerId  Int?
  manufacturer    Manufacturer?       @relation(fields: [manufacturerId], references: [id])

  chargingStation ChargingStation?    @relation(fields: [stationId], references: [id])

  @@index([serialNumber])
  @@index([status])
  @@index([manufacturerId])           // v2.0 추가
  @@map("charger_provisioning")
}

enum ProvisioningStatus {
  registered    // CS가 사전 등록한 상태 (프로비저닝 대기)
  provisioned   // 프로비저닝 완료
  rejected      // 거부됨 (미등록 시리얼번호)
  revoked       // 관리자가 수동으로 무효화
}
```

v2.0 변경 내용:

| 변경 항목 | 설명 |
|----------|------|
| `manufacturerId Int?` 추가 | 해당 시리얼을 등록한 제조사 FK. nullable — 마이그레이션 직후 기존 레코드는 `NULL`. |
| `manufacturer Manufacturer?` 관계 추가 | `manufacturerId` → `Manufacturer.id` |
| `@@index([manufacturerId])` 추가 | 제조사별 시리얼 목록 조회 최적화 |

### 4.3 `ChargingStation` 모델 변경 사항

```prisma
model ChargingStation {
  // ... 기존 필드 ...

  // 프로비저닝 추가 필드
  passwordHash    String?   @db.VarChar(255)  // OCPP Basic Auth 비밀번호 해시
  modelName       String?   @db.VarChar(100)  // 충전기 모델명 (/auths body.model)

  // 프로비저닝 역참조
  provisioning    ChargerProvisioning?

  // ... 기존 relations ...
}
```

### 4.4 충전기 아이디 시퀀스 관리

```prisma
model StationIdSequence {
  id          Int   @id @default(1)
  lastNumber  Int   @default(1000000)  // "EN" + 이 숫자

  @@map("station_id_sequence")
}
```

### 4.5 마이그레이션 절차

```bash
# 개발 환경
npx prisma migrate dev --name add_manufacturer_table

# 운영 환경 (DBA 승인 후)
npx prisma migrate deploy
```

마이그레이션 SQL 핵심 구문:

```sql
-- 신규 테이블
CREATE TABLE "manufacturer" (
  "id"          SERIAL         PRIMARY KEY,
  "channelId"   VARCHAR(50)    NOT NULL UNIQUE,
  "name"        VARCHAR(100)   NOT NULL,
  "tokenHash"   VARCHAR(255)   NOT NULL,
  "isActive"    BOOLEAN        NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)   NOT NULL
);
CREATE INDEX "manufacturer_channelId_idx" ON "manufacturer"("channelId");

-- charger_provisioning 변경
ALTER TABLE "charger_provisioning"
  ADD COLUMN "manufacturerId" INTEGER REFERENCES "manufacturer"("id");
CREATE INDEX "charger_provisioning_manufacturerId_idx" ON "charger_provisioning"("manufacturerId");
```

기존 레코드 처리 방침:

| 시나리오 | 처리 방침 |
|---------|---------|
| 마이그레이션 직후 기존 레코드 | `manufacturerId = NULL` — 기능 영향 없음 |
| 이미 `provisioned` 상태 충전기 | OCPP 운영에 영향 없음 |
| 신규 등록 시리얼 | CS 포털에서 제조사 선택 필수 → `manufacturerId` 반드시 설정 |

---

## 5. 인증 방식 상세 (v2.0)

### 5.1 `x-token`/`x-channel` 헤더 검증 흐름

```
요청 수신
    │
    ▼
[Step 1] x-token, x-channel 헤더 존재 확인
    ├─ 없음 → 401 Unauthorized
    └─ 있음 → ▼

[Step 2] x-channel로 Manufacturer DB 조회
    ├─ 없음 → 401 Unauthorized
    └─ 있음 → manufacturer 객체

[Step 3] bcrypt.compare(x-token, manufacturer.tokenHash)
    ├─ 불일치 → 401 Unauthorized
    └─ 일치 → ▼

[Step 4] manufacturer.isActive === true 확인
    ├─ false → 401 Unauthorized
    └─ true → 미들웨어 통과, req.manufacturer = manufacturer
```

### 5.2 제조사별 인증의 장점

| 항목 | 단일 토큰 방식 (v1.x) | 제조사별 토큰 방식 (v2.0) |
|------|---------------------|----------------------|
| 토큰 유출 영향 범위 | 전체 프로비저닝 엔드포인트 노출 | 해당 제조사 충전기만 노출 |
| 책임 추적 | 불가 | 채널 ID로 제조사 특정 가능 |
| Token Rotation | 전체 공지 후 일괄 교체 | 제조사별 개별 교체 |
| 비활성화 | 전체 차단 | 문제 제조사만 차단 |
| 감사 로그 | 요청자 구분 불가 | `x-channel`로 제조사 구분 |

---

## 6. 구현 가이드

### 6.1 manufacturerAuth 미들웨어 (`src/middlewares/manufacturerAuth.middleware.ts`)

구현 시점에 따라 파일 경로가 다를 수 있습니다.

```typescript
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '@config/database';
import { logger } from '@config/logger';

export async function manufacturerAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const xToken   = req.headers['x-token']   as string | undefined;
  const xChannel = req.headers['x-channel'] as string | undefined;

  if (!xToken || !xChannel) {
    res.status(401).json({
      code: 401, status: 'Unauthorized',
      message: '인증 헤더가 없습니다.',
      timestamp: getKSTTimestamp(),
      errors: null,
    });
    return;
  }

  const manufacturer = await prisma.manufacturer.findUnique({
    where: { channelId: xChannel },
  });

  if (!manufacturer || !manufacturer.isActive) {
    res.status(401).json({
      code: 401, status: 'Unauthorized',
      message: '인증에 실패하였습니다.',
      timestamp: getKSTTimestamp(),
      errors: null,
    });
    return;
  }

  const isValid = await bcrypt.compare(xToken, manufacturer.tokenHash);
  if (!isValid) {
    logger.warn({ channelId: xChannel }, 'manufacturerAuth: token mismatch');
    res.status(401).json({
      code: 401, status: 'Unauthorized',
      message: '인증에 실패하였습니다.',
      timestamp: getKSTTimestamp(),
      errors: null,
    });
    return;
  }

  (req as any).manufacturer = manufacturer;
  next();
}
```

### 6.2 프로비저닝 서비스 (`src/services/provision.service.ts`)

```typescript
import { prisma } from '@config/database';
import { env } from '@config/env';
import { hashPassword } from '@utils/password';
import { generateRandomPassword } from '@utils/crypto';
import { logger } from '@config/logger';
import { ConflictError, NotFoundError, ForbiddenError } from '@utils/errors';

interface ProvisionResult {
  code:      number;
  status:    string;
  message:   string;
  timestamp: string;
  data: {
    clientId: string;
    pwd:      string;
    wsUrl:    string;
  };
}

export class ProvisionService {
  // v2.0: manufacturerId 파라미터 추가
  async provision(
    serialNumber: string,
    model: string,
    manufacturerId: number
  ): Promise<ProvisionResult> {
    const record = await prisma.chargerProvisioning.findUnique({
      where: { serialNumber },
    });

    if (!record || record.status === 'rejected' || record.status === 'revoked') {
      logger.warn({ serialNumber }, 'Provision rejected: unregistered');
      throw new ForbiddenError('등록되지 않은 충전기입니다.');
    }

    // v2.0 정책 A: 제조사 채널 매핑 엄격 검증 (레거시 미매핑 레코드 거부)
    // - record.manufacturerId === null (CS 포털에서 제조사 미매핑) → 404
    // - record.manufacturerId !== 요청 manufacturerId (다른 제조사 시리얼) → 404
    // 두 경우 모두 동일 메시지로 응답 (시리얼 열거 공격 차단)
    if (record.manufacturerId !== manufacturerId) {
      logger.warn({ serialNumber, manufacturerId }, 'Provision rejected: manufacturer mismatch or unmapped legacy record');
      throw new NotFoundError('등록되지 않은 충전기입니다.');
    }

    if (record.status === 'provisioned') {
      logger.warn({ serialNumber, stationId: record.stationId }, 'Already provisioned');
      throw new ConflictError('이미 프로비저닝이 완료된 충전기입니다.');
    }

    // clientId 결정: 사전 지정값 우선, 없으면 자동 생성
    const clientId = record.clientId ?? await this.generateStationId();

    // 비밀번호 생성 (1회용 랜덤 32자)
    const plainPassword  = generateRandomPassword(32);
    const passwordHash   = await hashPassword(plainPassword);

    // 트랜잭션: ChargingStation 생성 + 프로비저닝 상태 업데이트
    await prisma.$transaction([
      prisma.chargingStation.upsert({
        where: { id: clientId },
        create: {
          id: clientId,
          serialNumber,
          passwordHash,
          modelName: model,
          status: 'Offline',
          isActive: true,
        },
        update: { passwordHash, modelName: model },
      }),
      prisma.chargerProvisioning.update({
        where: { serialNumber },
        data: {
          stationId:     clientId,
          status:        'provisioned',
          provisionedAt: new Date(),
        },
      }),
    ]);

    logger.info({ serialNumber, clientId }, 'Provisioning completed');

    return {
      code:      200,
      status:    'OK',
      message:   '프로비저닝이 완료되었습니다.',
      timestamp: getKSTTimestamp(),
      data: {
        clientId,
        pwd:   plainPassword,     // 평문 1회 반환
        wsUrl: env.CSMS_SERVER_URL,
      },
    };
  }

  private async generateStationId(): Promise<string> {
    const seq = await prisma.stationIdSequence.update({
      where: { id: 1 },
      data: { lastNumber: { increment: 1 } },
    });
    return `EN${seq.lastNumber.toString().padStart(7, '0')}`;
  }
}

export const provisionService = new ProvisionService();
```

### 6.3 프로비저닝 컨트롤러 (`src/controllers/provision.controller.ts`)

```typescript
import { Request, Response, NextFunction } from 'express';
import { authsBodySchema } from '@validators/provision.validator';
import { ProvisionService } from '@services/provision.service';

export class ProvisionController {
  constructor(private provisionService: ProvisionService) {}

  // POST /auths (v2.0)
  chargerAuth = async (req: Request, res: Response): Promise<void> => {
    const manufacturer = (req as any).manufacturer; // manufacturerAuth 미들웨어 주입

    const parseResult = authsBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        code: 400, status: 'Bad Request',
        message: '요청 형식이 올바르지 않습니다.',
        timestamp: getKSTTimestamp(),
        errors: parseResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { origin, model } = parseResult.data;

    try {
      const result = await this.provisionService.provision(origin, model, manufacturer.id);
      res.status(200).json(result);
    } catch (error) {
      // 공통 에러 핸들러로 위임
      next(error);
    }
  };
}
```

### 6.4 라우터 (`src/routes/index.ts`)

```typescript
// v2.0: manufacturerAuth 미들웨어 추가
import { manufacturerAuth } from '@middlewares/manufacturerAuth.middleware';

// Before (v1.x)
// router.post('/auths', provisionRateLimiter, provisionController.chargerAuth);

// After (v2.0)
router.post('/auths', provisionRateLimiter, manufacturerAuth, provisionController.chargerAuth);
```

### 6.5 CS 사전 등록 API (v2.0 변경)

```typescript
// provision.controller.ts — registerSchema (v2.0)
const registerSchema = z.object({
  serialNumber:   z.string().min(1).max(100),
  modelName:      z.string().max(100).optional(),
  clientId:       z.string().max(50).optional(),
  siteId:         z.number().int().positive().optional(),
  manufacturerId: z.number().int().positive(),  // v2.0 추가: 필수
});
```

### 6.6 제조사 서비스 (`src/services/manufacturer.service.ts`)

```typescript
import bcrypt from 'bcrypt';
import crypto from 'crypto';

export class ManufacturerService {
  constructor(private repo: ManufacturerRepository) {}

  /**
   * 제조사 등록 + x-token 신규 발급 (평문 토큰은 1회만 반환)
   */
  async create(data: { channelId: string; name: string }) {
    const existing = await this.repo.findByChannelId(data.channelId);
    if (existing) throw new ConflictError(`channelId '${data.channelId}'가 이미 사용 중입니다.`);

    const plainToken = crypto.randomBytes(32).toString('hex'); // 64자 hex
    const tokenHash  = await bcrypt.hash(plainToken, 12);

    const manufacturer = await this.repo.create({
      channelId: data.channelId,
      name:      data.name,
      tokenHash,
      isActive:  true,
    });

    return { manufacturer, plainToken }; // plainToken은 이 응답에서만 확인 가능
  }

  /**
   * 토큰 재발급 — 기존 tokenHash 즉시 무효화
   */
  async regenerateToken(id: number) {
    const manufacturer = await this.repo.findById(id);
    if (!manufacturer) throw new NotFoundError('제조사를 찾을 수 없습니다.');

    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash  = await bcrypt.hash(plainToken, 12);

    await this.repo.update(id, { tokenHash });
    return { plainToken };
  }
}
```

---

## 7. OCPP WebSocket 연결 전환 흐름

프로비저닝 완료 후 충전기는 수신한 `clientId`, `pwd`, `wsUrl`을 비휘발성 스토리지에 저장하고 OCPP 연결을 시도합니다.

```
1. /auths 응답 수신
   {
     data: {
       clientId: "EN1000001",
       pwd:      "xK9mP2qR7vL4nJ8sT1wY5oU6eA3bC0dF",
       wsUrl:    "wss://pvpentech.kr"
     }
   }

2. OCPP WebSocket URL 구성
   // 서버는 두 경로 모두 지원 (권장: 옵션 B)
   옵션 A: wss://pvpentech.kr/EN1000001
   옵션 B: wss://pvpentech.kr/ocpp/EN1000001  (권장)

3. OCPP Basic Auth 헤더 구성
   credentials = base64("EN1000001:xK9mP2qR7vL4nJ8sT1wY5oU6eA3bC0dF")
   Header: Authorization: Basic RU4xMDAwMDAxOnhLOW1QMnFS...

4. WebSocket 연결 요청
   URL: wss://pvpentech.kr/ocpp/EN1000001
   Headers:
     Sec-WebSocket-Protocol: ocpp1.6
     Authorization: Basic <base64>

5. CSMS Basic Auth 검증 (OCPP 체계, v2.0 변경 없음)
   - stationId = "EN1000001" 추출
   - DB에서 ChargingStation.passwordHash 조회
   - bcrypt.compare(pwd, passwordHash) 검증

6. 연결 수립 후 BootNotification 수신
   - ChargingStation.status → Online
   - lastHeartbeatAt 업데이트
```

---

## 8. 보안 고려사항

### 8.1 다계층 보안 구조 (v2.0)

```
레이어 1: TLS 1.2/1.3 + Let's Encrypt ECDSA (SSL Labs A+)
         → MITM 공격 차단, 헤더 암호화 보장

레이어 2: x-token/x-channel 커스텀 헤더 (bcrypt cost=12 해시 저장)
         → 제조사 인증 + rainbow table 공격 차단

레이어 3: 시리얼번호 화이트리스트 (사전 등록 필수)
         → 임의 시리얼 등록 차단

레이어 4: One-shot 발급 (409 재호출 차단)
         → 중복 발급 공격 차단

레이어 5: Rate Limiting (provisionRateLimiter, IP당 분당 5회)
         → brute-force 차단

레이어 6: Pino 구조화 감사 로그 (x-channel, origin, IP 기록)
         → 이상 접근 탐지 및 포렌식
```

### 8.2 위협 모델 및 대응 장치

| 위협 | 대응 장치 | 구현 위치 |
|------|---------|---------|
| 토큰 유출 | bcrypt 해시 저장 (cost=12) | `manufacturer.service.ts` |
| 토큰 유출 영향 범위 | 제조사별 독립 토큰 (`x-channel`) | `Manufacturer` 테이블 |
| 시리얼 열거 | 404 응답 메시지 통일 (구체적 사유 미노출) | `provision.service.ts` |
| 시리얼 열거 | Rate Limiting | `src/routes/index.ts` |
| MITM | TLS 1.2/1.3 + Let's Encrypt | AWS ALB / Nginx |
| 중복 발급 | One-shot 정책 (409) | `provision.service.ts` |
| 이상 접근 | Pino 구조화 감사 로그 | `provision.controller.ts` |
| 비활성화 | `isActive=false` 즉시 차단 | `manufacturerAuth.middleware.ts` |

### 8.3 OCPP 비밀번호 보안

```typescript
// src/utils/crypto.ts
import crypto from 'crypto';

export function generateRandomPassword(length: number): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}
```

- 비밀번호는 프로비저닝 응답에서 **1회만** 평문으로 전달
- 서버는 bcrypt 해시만 저장 (평문 보관 없음)
- 충전기 비밀번호 분실 시: CS 포탈에서 재발급 (`PATCH /api/portal/cs/stations/:id/reset-password`)

### 8.4 향후 강화 옵션

| 옵션 | 설명 | 우선순위 |
|------|------|--------|
| 도메인 분리 | `auth.pvpentech.kr` → `/auths` 전용 서브도메인 분리 | 중 |
| 토큰 정기 Rotation | 6개월/1년 단위 `x-token` 재발급 의무화 | 중 |
| IP 화이트리스트 | 제조사 공장 IP 대역만 `/auths` 허용 | 낮음 |
| mTLS (Security Profile 3) | OCPP 접속에 클라이언트 인증서 도입 | 낮음 (장기) |

---

## 9. 다국어 지원 (i18n)

`locales/{언어코드}/provisioning.json`에 프로비저닝 메시지를 관리합니다.

```json
// locales/ko/provisioning.json
{
  "provisionSuccess":     "프로비저닝이 완료되었습니다.",
  "provisionRejected":    "등록되지 않은 충전기입니다.",
  "alreadyProvisioned":   "이미 프로비저닝이 완료된 충전기입니다.",
  "authHeaderMissing":    "인증 헤더가 없습니다.",
  "authFailed":           "인증에 실패하였습니다.",
  "invalidBody":          "요청 형식이 올바르지 않습니다."
}

// locales/en/provisioning.json
{
  "provisionSuccess":     "Provisioning completed successfully.",
  "provisionRejected":    "Unregistered charging station.",
  "alreadyProvisioned":   "This station has already been provisioned.",
  "authHeaderMissing":    "Authentication headers are missing.",
  "authFailed":           "Authentication failed.",
  "invalidBody":          "Invalid request format."
}

// locales/vi/provisioning.json
{
  "provisionSuccess":     "Cap phep hoan tat thanh cong.",
  "provisionRejected":    "Tram sac chua duoc dang ky.",
  "alreadyProvisioned":   "Tram sac nay da duoc cap phep roi.",
  "authHeaderMissing":    "Thieu tieu de xac thuc.",
  "authFailed":           "Xac thuc that bai.",
  "invalidBody":          "Dinh dang yeu cau khong hop le."
}
```

---

## 10. 디렉토리 구조

```
src/
├── middlewares/
│   └── manufacturerAuth.middleware.ts  ← v2.0 신규
├── routes/
│   ├── index.ts                        ← /auths 미들웨어 적용 변경
│   └── portal/
│       └── cs/
│           └── manufacturer.routes.ts  ← v2.0 신규
├── controllers/
│   ├── provision.controller.ts         ← chargerAuth 변경 (model 필수)
│   └── manufacturer.controller.ts      ← v2.0 신규
├── services/
│   ├── provision.service.ts            ← provision() manufacturerId 추가
│   └── manufacturer.service.ts         ← v2.0 신규
├── repositories/
│   └── manufacturer.repository.ts      ← v2.0 신규
├── validators/
│   ├── provision.validator.ts          ← authsBodySchema model 필수화
│   └── manufacturer.validator.ts       ← v2.0 신규
└── utils/
    └── crypto.ts                       ← 랜덤 비밀번호 생성

prisma/
└── schema.prisma
    ├── Manufacturer model              ← v2.0 신규
    ├── ChargerProvisioning             ← manufacturerId FK 추가
    └── StationIdSequence model         ← 기존

locales/
├── ko/provisioning.json               ← v2.0 메시지 추가
├── en/provisioning.json               ← v2.0 메시지 추가
└── vi/provisioning.json               ← v2.0 메시지 추가
```

---

## 11. 환경 변수

```bash
# .env.example

# 프로비저닝 서버 설정
CSMS_SERVER_URL=wss://pvpentech.kr           # /auths 응답의 data.wsUrl로 사용
PROVISION_ALLOWED_CIDRS=                      # 빈값=모두 허용, "1.2.3.0/24" 형식 (선택)

# v2.0 신규 환경 변수 없음
# x-token/x-channel은 DB에서 동적 관리 (환경 변수 방식 사용 안 함)
```

---

## 12. CS 포탈 API 명세

### 12.1 시리얼번호 관리 API (기존 + v2.0 변경)

```
GET  /api/portal/cs/provisioning                   # 목록 조회 (상태/제조사 필터, 키워드 검색)
POST /api/portal/cs/provisioning                   # 시리얼번호 사전 등록 (manufacturerId 필수)
GET  /api/portal/cs/provisioning/:id               # 상세 조회
PUT  /api/portal/cs/provisioning/:id               # 수정 (provisioned 시 serialNumber 변경 불가)
DELETE /api/portal/cs/provisioning/:id             # 등록 취소
PATCH /api/portal/cs/provisioning/:id/revoke       # 강제 무효화 (status=revoked)
POST /api/portal/cs/provisioning/bulk-upload       # CSV 일괄 등록 (manufacturerChannelId 컬럼 추가)
GET  /api/portal/cs/provisioning/sample-csv        # 샘플 CSV 다운로드
POST /api/portal/cs/stations/:id/reset-password    # 충전기 비밀번호 재발급
```

### 12.2 제조사 관리 API (v2.0 신규)

| Method | 경로 | 설명 | 응답 특이사항 |
|--------|------|------|-------------|
| `GET` | `/api/portal/cs/manufacturers` | 제조사 목록 조회 (페이지네이션) | - |
| `POST` | `/api/portal/cs/manufacturers` | 제조사 등록 + 토큰 발급 | 응답에 `plainToken` 1회 포함 |
| `GET` | `/api/portal/cs/manufacturers/:id` | 제조사 상세 조회 | `tokenHash` 미포함 |
| `PUT` | `/api/portal/cs/manufacturers/:id` | 제조사 정보 수정 (`name`, `isActive`) | - |
| `POST` | `/api/portal/cs/manufacturers/:id/regenerate-token` | 토큰 재발급 | 응답에 `plainToken` 1회 포함, 기존 토큰 즉시 무효화 |
| `DELETE` | `/api/portal/cs/manufacturers/:id` | 비활성화 (소프트 삭제) | `isActive=false` 처리 |

#### 제조사 등록 응답 예시 (201)

```json
{
  "success": true,
  "data": {
    "id": 1,
    "channelId": "vendor_a",
    "name": "VendorA Co., Ltd.",
    "isActive": true,
    "createdAt": "2026-05-07T14:30:00.000Z",
    "plainToken": "a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1"
  },
  "notice": "plainToken은 이 응답에서만 확인 가능합니다. 제조사에 안전하게 전달 후 보관하세요."
}
```

> `plainToken`은 이 응답 외에 재조회 불가. 분실 시 `/regenerate-token` API로 재발급.

### 12.3 ChargerConfig API (v1.1 기존)

```
GET    /api/portal/cs/provisioning/configs           # ChargerConfig 목록 (stationId 필터)
POST   /api/portal/cs/provisioning/configs           # ChargerConfig 생성 (stationId+key unique)
PUT    /api/portal/cs/provisioning/configs/:id       # ChargerConfig 수정
DELETE /api/portal/cs/provisioning/configs/:id       # ChargerConfig 삭제
```

---

## 13. 마이그레이션 / 롤아웃 계획

```
Phase 1: DB 스키마 확장
─────────────────────
목표: Manufacturer 테이블 추가, 기존 기능 영향 없음
작업:
  - Manufacturer 모델 추가
  - ChargerProvisioning에 manufacturerId (nullable) 추가
  - npx prisma migrate dev --name add_manufacturer_table
검증: prisma studio에서 테이블 생성 확인

Phase 2: 제조사 관리 API 개발
──────────────────────────
목표: CS 포털에서 제조사 등록/토큰 발급 가능
작업:
  - manufacturer.repository / service / controller / routes 구현
  - CS 포털 UI 제조사 관리 화면 개발
검증: Postman으로 /auths에 x-token/x-channel 헤더 포함 테스트

Phase 3: /auths 미들웨어 적용 (테스트 환경)
─────────────────────────────────────────
목표: manufacturerAuth 미들웨어를 /auths에 적용, 테스트 환경 검증
작업:
  - manufacturerAuth.middleware.ts 구현
  - src/routes/index.ts 미들웨어 적용
  - model 필드 required 강화
  - 통합 테스트 T01~T14 실행
검증: 모든 오류 시나리오(400/401/404/409/500) 검증 완료

Phase 4: 운영 적용
─────────────────
목표: 운영 환경 배포, 신규 충전기부터 v2.0 프로비저닝 적용
작업:
  - 운영 DB 마이그레이션 (npx prisma migrate deploy)
  - 제조사별 x-token/x-channel 사전 발급 (CS 담당자)
  - 제조사에 v2.0 가이드 문서 전달
  - 기존 ChargerProvisioning 레코드에 manufacturerId 일괄 매핑
검증: 파일럿 제조사 1개사 실제 프로비저닝 테스트
```

### 12.2 레거시 레코드 처리 정책 (정책 A — 채택 확정)

v2.0 마이그레이션 직후 기존 `ChargerProvisioning` 레코드의 `manufacturerId`는 `NULL` 상태입니다. 이들에 대한 처리 정책:

**채택: 정책 A — 모두 거부 (404)**

```
record.manufacturerId === null AND /auths 호출
  → 404 (등록되지 않은 충전기입니다)
```

- 레거시 레코드는 **CS 포털에서 명시적으로 제조사 매핑을 완료할 때까지** `/auths`를 통과하지 못함
- 마이그레이션 시점에 다음 작업 필수:
  1. 제조사별 `x-token`/`x-channel` 발급 (CS 포털 제조사 관리)
  2. `ChargerProvisioning.manufacturerId` 일괄 매핑 (CSV 업로드 또는 DB UPDATE)
  3. 매핑 안 된 시리얼은 `revoked` 처리 또는 매핑 완료까지 보류

**보안 효과**:
- 누락된 레거시 레코드를 통해 우회 발급되는 경로를 원천 차단
- 시리얼 열거 공격 시 어떤 시리얼이 등록/매핑됐는지 추론 불가 (모두 동일 404)

**다른 정책(B/C) 미채택 사유**:
- (B) Grace period 임시 허용: 보안 hole 가능성, 운영 분기 코드 복잡도 ↑
- (C) 자동 default manufacturer 매핑: 책임 추적 모호, 제조사별 격리 무력화

---

## 14. 테스트 계획

### 14.1 통합 테스트 시나리오

| 테스트 ID | 시나리오 | 예상 응답 |
|----------|---------|---------|
| T01 | 정상 프로비저닝 (최초 호출) | 200 + `{clientId, pwd, wsUrl}` |
| T02 | `x-token` 헤더 누락 | 401 |
| T03 | `x-channel` 헤더 누락 | 401 |
| T04 | 잘못된 `x-token` (토큰 불일치) | 401 |
| T05 | 존재하지 않는 `x-channel` | 401 |
| T06 | 비활성화된 제조사 (`isActive=false`) | 401 |
| T07 | 미등록 시리얼 (`origin` DB 없음) | 404 |
| T08 | 다른 제조사 시리얼 (제조사 A 토큰으로 제조사 B 시리얼 요청) | 404 |
| T09 | 이미 `provisioned` 상태에서 재호출 | 409 |
| T10 | `model` 필드 누락 | 400 |
| T11 | `origin` 필드 누락 | 400 |
| T12 | `status=rejected` 시리얼 | 401 |
| T13 | CS reset 후 재프로비저닝 | 200 |
| T14 | 응답 `wsUrl`로 OCPP 접속 | WebSocket 101 |

### 14.2 테스트 요청 예시

```bash
# T01 — 정상 프로비저닝
curl -X POST https://localhost:3000/auths \
  -H "Content-Type: application/json" \
  -H "x-token: a3f9b2c1d4e5..." \
  -H "x-channel: vendor_a" \
  -d '{"origin": "CP-VDA-00123", "model": "VDA-7kW-AC01"}'

# T02 — x-token 누락
curl -X POST https://localhost:3000/auths \
  -H "Content-Type: application/json" \
  -H "x-channel: vendor_a" \
  -d '{"origin": "CP-VDA-00123", "model": "VDA-7kW-AC01"}'

# T10 — model 누락 (v2.0 체크)
curl -X POST https://localhost:3000/auths \
  -H "Content-Type: application/json" \
  -H "x-token: a3f9b2c1d4e5..." \
  -H "x-channel: vendor_a" \
  -d '{"origin": "CP-VDA-00123"}'
```

---

## 15. 체크리스트

### DB / Prisma

- [ ] `prisma/schema.prisma`에 `Manufacturer` 모델 추가 (v2.0)
- [ ] `ChargerProvisioning`에 `manufacturerId Int?` FK 추가 (v2.0)
- [ ] `ChargerProvisioning`에 `@@index([manufacturerId])` 추가 (v2.0)
- [ ] `npx prisma migrate dev --name add_manufacturer_table` 실행
- [ ] `npx prisma generate` 실행
- [ ] `station_id_sequence` 테이블 생성 + 초기값(1000000) 시드 데이터 삽입
- [ ] `ChargingStation`에 `passwordHash`, `modelName` 필드 추가

### 제조사 관리 기능 (v2.0 신규)

- [ ] `src/repositories/manufacturer.repository.ts` 구현
- [ ] `src/validators/manufacturer.validator.ts` Zod 스키마 작성
- [ ] `src/services/manufacturer.service.ts` CRUD + 토큰 발급/재발급 구현
- [ ] `src/controllers/manufacturer.controller.ts` 구현
- [ ] `src/routes/portal/cs/manufacturer.routes.ts` 등록

### `/auths` 미들웨어 및 라우트 (v2.0 변경)

- [ ] `src/middlewares/manufacturerAuth.middleware.ts` 구현
- [ ] `provision.controller.ts:chargerAuth` — `model` 필드 필수화 (Zod)
- [ ] `provision.service.ts:provision` — `manufacturerId` 파라미터 추가 및 매핑 검증
- [ ] `src/routes/index.ts` — `/auths` 라우트에 `manufacturerAuth` 미들웨어 추가

### CS 포털 (v2.0 변경)

- [ ] 시리얼 등록 API에 `manufacturerId` 필수 추가
- [ ] CS 포털 제조사 관리 화면 구현 (목록/등록/수정/토큰 재발급)
- [ ] CS 포털 시리얼 등록 화면에 제조사 선택 필드 추가
- [ ] CSV 일괄 등록에 `manufacturerChannelId` 컬럼 추가

### Swagger / 문서

- [ ] `/auths` Swagger 주석 — `basicAuth` 제거, `x-token`/`x-channel` 헤더 파라미터 추가
- [ ] `model` 필드 `required` 반영
- [ ] 오류 응답 코드표 업데이트 (400/401/404/409/500)

### 다국어

- [ ] `locales/ko/provisioning.json` — v2.0 신규 메시지 추가
- [ ] `locales/en/provisioning.json` — v2.0 신규 메시지 추가
- [ ] `locales/vi/provisioning.json` — v2.0 신규 메시지 추가

### 기존 항목 (v1.x 유지)

- [ ] `POST /auths` 엔드포인트 구현 (Rate Limiting 포함)
- [ ] 충전기 아이디 생성 로직 (`"EN" + 7자리`) 구현 (원자적 시퀀스 증가)
- [ ] 프로비저닝 응답 시 랜덤 비밀번호 생성 + bcrypt 해시 저장
- [ ] OCPP Basic Auth 검증 시 `ChargingStation.passwordHash` 조회 로직 구현
- [ ] 프로비저닝 이후 중복 요청 방지 (status='provisioned' 체크, 409)
- [ ] IP Rate Limiting 적용 (분당 5회 제한)
- [ ] HTTPS 강제 적용 (`/auths` 경로는 HTTP 허용 안 함)
- [ ] 환경 변수 `CSMS_SERVER_URL` 추가

### 테스트

- [ ] `manufacturerAuth` 미들웨어 단위 테스트
- [ ] `provision.service` 제조사 매핑 단위 테스트
- [ ] 통합 테스트 T01~T14 전체 실행
- [ ] Rate Limit 동작 확인

### [v1.1 기존] 추가 기능

- [ ] `GET /api/portal/cs/provisioning?keyword=` 키워드 검색 (serialNumber/stationId/registeredBy OR 검색)
- [ ] `POST /api/portal/cs/provisioning/bulk-upload` CSV 일괄 등록 (multer + csv-parse)
- [ ] `GET /api/portal/cs/provisioning/sample-csv` 샘플 CSV 다운로드
- [ ] `PUT /api/portal/cs/provisioning/:id` 프로비저닝 수정
- [ ] `GET /api/portal/cs/provisioning/configs` ChargerConfig 목록
- [ ] `POST /api/portal/cs/provisioning/configs` ChargerConfig 생성
- [ ] `PUT /api/portal/cs/provisioning/configs/:id` ChargerConfig 수정
- [ ] `DELETE /api/portal/cs/provisioning/configs/:id` ChargerConfig 삭제
