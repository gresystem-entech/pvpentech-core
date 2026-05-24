# Pvpentech `/auths` 충전기 프로비저닝 API 신규 명세 (v2.0)

> **저장 경로**: `outputs/auths_provisioning_revised_design.md`
> **관련 가이드**: `documents/design_guide/12_charger_provisioning.md` (v2.0 업데이트 예정)

---

## 섹션 1. 문서 메타데이터

| 항목 | 내용 |
|------|------|
| 문서 제목 | Pvpentech 충전기 프로비저닝 API 신규 명세 |
| 버전 | v2.0 |
| 작성일 | 2026-05-07 |
| 작성자 | Pvpentech 설계팀 |
| 대상 독자 | 백엔드 개발자, CS 담당자, 충전기 제조사 |
| 관련 문서 | `documents/design_guide/12_charger_provisioning.md` |

### 1.1 변경 이력

| 버전 | 날짜 | 핵심 변경 내용 |
|------|------|--------------|
| v1.0 | 최초 작성 | Basic Auth (`Authorization: Basic`) 기반 프로비저닝 설계 |
| v1.1 | 이전 업데이트 | status=`registered` 체크, 409 One-shot 정책 추가, `model` 필드 optional 추가 |
| **v2.0** | **2026-05-07** | **인증 방식 변경: Basic Auth → `x-token`/`x-channel` 커스텀 헤더. `model` 필드 필수화. `Manufacturer` 테이블 신규 추가. 제조사별 격리 인증 도입.** |

### 1.2 v1.x → v2.0 핵심 변경점 한눈에 보기

| 구분 | v1.x | v2.0 |
|------|------|------|
| 인증 방식 | `Authorization: Basic base64(token)` | `x-token` + `x-channel` 커스텀 헤더 |
| 제조사 구분 | 없음 (단일 토큰) | 제조사별 채널(`x-channel`) 독립 토큰 |
| `model` 필드 | optional | **필수(required)** |
| Manufacturer DB | 없음 | `manufacturer` 테이블 신규 추가 |
| ChargerProvisioning | `manufacturerId` 없음 | `manufacturerId` FK 추가 |
| 409 재호출 정책 | 동일 | 동일 (One-shot 유지) |
| `wsUrl` 응답 | 포함 | 포함 (PlugLink와 달리 유지) |
| 도메인 | 단일 도메인 | 단일 도메인 유지 (향후 분리 검토) |

---

## 섹션 2. 개요

### 2.1 `/auths` 엔드포인트 목적

`POST /auths`는 충전기 제조사 펌웨어가 최초 현장 설치 시 Pvpentech CSMS에 자신을 등록하고 OCPP 접속 정보를 수신하는 **프로비저닝 단일 진입점**이다.

- 충전기는 공장 출고 시 `x-token`, `x-channel`, 시리얼번호(`origin`), 모델명(`model`)을 펌웨어에 내장
- 현장 전원 인가 후 `/auths` 호출 → `clientId`, `pwd`, `wsUrl` 수신
- 이후 수신한 정보로 OCPP WebSocket 접속, `BootNotification` 전송

### 2.2 PlugLink 모델 채택 배경

기존 Basic Auth 방식(`Authorization: Basic base64(token)`)은 모든 제조사가 동일한 토큰을 공유하는 구조로, 한 제조사의 토큰 유출 시 전체 프로비저닝 엔드포인트가 노출되는 문제가 있었다.

PlugLink의 `x-token`/`x-channel` 헤더 방식은 **제조사별 독립 인증**을 제공하며, 토큰 유출 시 영향 범위를 해당 제조사로 한정한다. Pvpentech v2.0은 이 방식을 채택하되, PlugLink와 달리 응답에 `wsUrl`을 포함하고 `model` 필드를 필수로 유지하는 방향으로 설계한다.

### 2.3 신/구 시나리오 핵심 차이

| 항목 | 구 시나리오 (v1.x) | 신 시나리오 (v2.0) |
|------|------------------|-----------------|
| 헤더 | `Authorization: Basic <token>` | `x-token: <token>` + `x-channel: <channelId>` |
| 제조사 식별 | 없음 | `x-channel` 값으로 Manufacturer 조회 |
| 토큰 범위 | 전체 공유 | 제조사 단위 격리 |
| `model` 필수 여부 | optional | required |
| DB 연관 | ChargerProvisioning만 | ChargerProvisioning + Manufacturer |
| 토큰 저장 | 평문 또는 단순 비교 | bcrypt 해시 저장, 비교 |
| 토큰 관리 | 수동 | CS 포털에서 발급/재발급/비활성화 |

---

## 섹션 3. API 명세 — `POST /auths`

### 3.1 Request

#### URL 및 Method

```
POST https://pvpentech.kr/auths
Content-Type: application/json
```

#### 3.1.1 Request Headers

| 헤더 이름 | 필수 | 설명 | 예시 |
|----------|------|------|------|
| `x-token` | 필수 | 제조사 인증 토큰 (CS 포털에서 발급된 평문 토큰) | `x-token: eyJhbGci...` |
| `x-channel` | 필수 | 제조사 채널 ID (CS가 등록 시 부여한 식별자) | `x-channel: vendor_a` |
| `Content-Type` | 필수 | 반드시 `application/json` | `Content-Type: application/json` |

> **주의**: `Authorization` 헤더는 v2.0부터 사용하지 않는다. `x-token`/`x-channel` 헤더를 누락하면 즉시 401 응답한다.

#### 3.1.2 Request Body Schema (TypeScript)

```typescript
interface AuthsRequestBody {
  origin: string;  // 필수 — 충전기 시리얼번호 (제조사 부여, 1~100자)
  model:  string;  // 필수 — 충전기 모델명 (제조사 부여, 1~100자) — v2.0부터 required
}
```

#### Zod Validation Schema

```typescript
import { z } from 'zod';

export const authsBodySchema = z.object({
  origin: z.string().min(1).max(100),
  model:  z.string().min(1).max(100),   // v2.0: optional → required
});

export type AuthsBody = z.infer<typeof authsBodySchema>;
```

#### 3.1.3 Request Body 필드 설명

| 필드 | 타입 | 필수 | 설명 | 예시 |
|------|------|------|------|------|
| `origin` | `string` | 필수 | 충전기 시리얼번호. 제조사가 부여한 고유 식별자. DB의 `charger_provisioning.serial_number`와 매핑. | `"CP-VDA-00123"` |
| `model` | `string` | 필수 | 충전기 모델명. `charging_station.model_name`에 저장. | `"VDA-7kW-AC01"` |

#### 3.1.4 HTTP Request 예시 (cURL)

```bash
curl -X POST https://pvpentech.kr/auths \
  -H "Content-Type: application/json" \
  -H "x-token: <EXAMPLE_TOKEN_PLACEHOLDER>" \
  -H "x-channel: vendor_a" \
  -d '{
    "origin": "CP-VDA-00123",
    "model":  "VDA-7kW-AC01"
  }'
```

---

### 3.2 Response — 성공 200

#### TypeScript Interface

```typescript
interface AuthsSuccessResponse {
  code:      200;
  status:    'OK';
  message:   string;
  timestamp: string;       // KST "YYYY-MM-DD HH:mm:ss"
  data: {
    clientId: string;      // 발급된 충전기 식별자 (예: "EN1000001")
    pwd:      string;      // OCPP Basic Auth용 평문 비밀번호 (32자 랜덤)
    wsUrl:    string;      // OCPP WebSocket 서버 URL (예: "wss://pvpentech.kr")
  };
}
```

#### JSON 응답 예시

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

#### 3.2.1 응답 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `code` | `number` | HTTP 상태 코드와 동일 (200) |
| `status` | `string` | 응답 상태 문자열 (`"OK"`) |
| `message` | `string` | 사용자 친화적 메시지 (다국어 대응) |
| `timestamp` | `string` | 서버 처리 완료 시각 — **KST** 기준 `YYYY-MM-DD HH:mm:ss` 형식 |
| `data.clientId` | `string` | 발급된 충전기 식별자. `EN` 접두사 + 7자리 숫자. OCPP 접속 경로에 사용. |
| `data.pwd` | `string` | OCPP Basic Auth 비밀번호 (평문, 32자 랜덤). **이 응답 외에는 복원 불가** — 서버에는 bcrypt 해시만 저장. |
| `data.wsUrl` | `string` | OCPP WebSocket 서버 기본 URL. 충전기는 이 URL에 `/<clientId>` 또는 `/ocpp/<clientId>`를 붙여 접속. |

> **timestamp 형식 주의**: ISO 8601 형식(`2026-05-07T14:30:00Z`)이 아닌 KST `YYYY-MM-DD HH:mm:ss` 형식을 사용한다. 서버 내부에서 `new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })` 또는 `dayjs().tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')`으로 생성.

---

### 3.3 Response — 실패

#### 3.3.1 400 Bad Request — 요청 형식 오류

요청 헤더의 `Content-Type`이 올바르지 않거나 body의 필수 필드(`origin`, `model`)가 누락되었거나 형식이 잘못된 경우.

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

| 발생 조건 | 예시 |
|----------|------|
| `origin` 누락 | body에 `origin` 키 없음 |
| `model` 누락 | body에 `model` 키 없음 (v2.0부터 required) |
| 타입 오류 | `origin`에 숫자 전달 |
| 길이 초과 | `model`이 100자 초과 |

#### 3.3.2 401 Unauthorized — 헤더 검증 실패

`x-token` 또는 `x-channel` 헤더가 없거나, 토큰 값이 DB의 해시와 일치하지 않거나, 제조사가 비활성화된 경우.

```json
{
  "code": 401,
  "status": "Unauthorized",
  "message": "인증에 실패하였습니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

| 발생 조건 |
|----------|
| `x-token` 헤더 없음 |
| `x-channel` 헤더 없음 |
| `x-channel`로 조회되는 Manufacturer 없음 |
| `x-token`과 `manufacturer.tokenHash` bcrypt 불일치 |
| `manufacturer.isActive === false` |
| ChargerProvisioning의 `status`가 `rejected` 또는 `revoked` |

> **401 vs 404 구분 원칙**: 401은 **헤더 인증 실패** (제조사 수준 문제), 404는 **시리얼번호 조회 실패** (충전기 수준 문제). 두 오류를 명확히 분리해야 한다.

#### 3.3.3 404 Not Found — 시리얼 미등록 또는 채널 불일치

`origin`(시리얼번호)이 DB에 없거나, 해당 시리얼이 다른 제조사 채널에 등록된 경우.

```json
{
  "code": 404,
  "status": "Not Found",
  "message": "등록되지 않은 충전기입니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

| 발생 조건 |
|----------|
| `serialNumber = origin`으로 `ChargerProvisioning` 미조회 |
| `ChargerProvisioning.manufacturerId ≠ 인증된 Manufacturer.id` (다른 제조사 시리얼) |

> **보안 주의**: 404 응답 메시지는 시리얼 미등록인지, 채널 불일치인지를 구분하지 **않는다**. 두 경우 모두 동일한 응답으로 처리하여 시리얼 열거(enumeration) 공격을 차단한다.

#### 3.3.4 409 Conflict — 이미 프로비저닝 완료

동일 시리얼로 재호출했으나 이미 `status = 'provisioned'` 상태인 경우.

```json
{
  "code": 409,
  "status": "Conflict",
  "message": "이미 프로비저닝이 완료된 충전기입니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

One-shot 정책: 최초 호출만 200을 반환하고, 이후 재호출은 모두 409를 반환한다. 분실 또는 재설치가 필요한 경우 CS 포털에서 reset 처리 후 재호출한다.

#### 3.3.5 500 Internal Server Error

DB 장애, 트랜잭션 실패 등 서버 내부 오류.

```json
{
  "code": 500,
  "status": "Internal Server Error",
  "message": "서버 내부 오류가 발생하였습니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

#### 3.3.6 오류 응답 코드 요약표

| HTTP 코드 | 의미 | 주요 발생 원인 |
|----------|------|-------------|
| `400` | 요청 형식 오류 | body 필수 필드 누락, 타입/길이 오류 |
| `401` | 인증 실패 | `x-token`/`x-channel` 누락, 토큰 불일치, 제조사 비활성화 |
| `404` | 리소스 없음 | 시리얼 미등록, 다른 제조사 채널 시리얼 |
| `409` | 충돌 | 이미 `provisioned` 상태에서 재호출 |
| `500` | 서버 오류 | DB 장애, 예상치 못한 예외 |

---

### 3.4 충전기 측 후처리 — 응답 받은 후 흐름

#### 3.4.1 OCPP WebSocket URL 구성

```
wsUrl   = data.wsUrl    // 예: "wss://pvpentech.kr"
clientId = data.clientId // 예: "EN1000001"

// 접속 경로 (서버는 두 경로 모두 지원)
옵션 A: wss://pvpentech.kr/EN1000001
옵션 B: wss://pvpentech.kr/ocpp/EN1000001
```

> 서버(`src/ocpp/server.ts`)는 `/<stationId>` 와 `/ocpp/<stationId>` 두 경로를 모두 허용하므로 제조사 펌웨어는 어느 형식을 사용해도 된다. 단, 일관성을 위해 **옵션 B (`/ocpp/<clientId>`)를 권장**한다.

#### 3.4.2 OCPP Basic Auth 헤더 구성

OCPP 접속 시 WebSocket Upgrade 요청에 Basic Auth 헤더를 포함한다.

```
credentials = base64(clientId + ":" + pwd)
              = base64("EN1000001:xK9mP2qR7vL4nJ8sT1wY5oU6eA3bC0dF")

HTTP Header:
  Authorization: Basic RU4xMDAwMDAxOnhLOW1QMnFSN3ZMNGs...
```

#### 3.4.3 BootNotification 흐름

```
1. /auths 응답 저장 (clientId, pwd, wsUrl) — 비휘발성 스토리지에 저장 권장
2. OCPP WebSocket 접속:
   URL: wss://pvpentech.kr/ocpp/EN1000001
   Header: Authorization: Basic base64(EN1000001:pwd)
   SubProtocol: ocpp1.6
3. BootNotification 전송:
   {
     "chargePointModel":       "VDA-7kW-AC01",
     "chargePointSerialNumber": "CP-VDA-00123",
     "chargePointVendor":       "VendorA",
     "firmwareVersion":         "1.0.3"
   }
4. 서버 응답 Accepted → 정상 운영 시작
```

---

## 섹션 4. 인증 방식 상세

### 4.1 `x-token` / `x-channel` 헤더 검증 흐름

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

#### `manufacturerAuth.middleware.ts` 구현 개요

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
    res.status(401).json({ code: 401, status: 'Unauthorized', message: '인증 헤더가 없습니다.', errors: null });
    return;
  }

  const manufacturer = await prisma.manufacturer.findUnique({
    where: { channelId: xChannel },
  });

  if (!manufacturer || !manufacturer.isActive) {
    res.status(401).json({ code: 401, status: 'Unauthorized', message: '인증에 실패하였습니다.', errors: null });
    return;
  }

  const isValid = await bcrypt.compare(xToken, manufacturer.tokenHash);
  if (!isValid) {
    logger.warn({ channelId: xChannel }, 'manufacturerAuth: token mismatch');
    res.status(401).json({ code: 401, status: 'Unauthorized', message: '인증에 실패하였습니다.', errors: null });
    return;
  }

  // 미들웨어 통과: req에 manufacturer 정보 주입
  (req as any).manufacturer = manufacturer;
  next();
}
```

### 4.2 보안 분석

#### 4.2.1 제조사별 인증의 장점

| 항목 | 단일 토큰 방식 (v1.x) | 제조사별 토큰 방식 (v2.0) |
|------|---------------------|----------------------|
| 토큰 유출 영향 범위 | 전체 프로비저닝 엔드포인트 노출 | 해당 제조사 충전기만 노출 |
| 책임 추적 | 불가 | 채널 ID로 제조사 특정 가능 |
| Rotation | 전체 공지 후 일괄 교체 | 제조사별 개별 교체 |
| 비활성화 | 전체 차단 | 문제 제조사만 차단 |
| 감사 로그 | 요청자 구분 불가 | `x-channel`로 제조사 구분 |

#### 4.2.2 토큰 유출 시 영향 범위

- 유출된 토큰은 해당 `x-channel`에 대응하는 **제조사의 충전기만 프로비저닝 가능**
- 공격자가 유효한 `x-channel`을 알아도 다른 제조사에 등록된 시리얼은 404 응답
- 발견 즉시 CS 포털에서 해당 채널의 토큰 재발급으로 격리 가능
- 이미 프로비저닝된 충전기의 OCPP 접속에는 영향 없음 (다른 인증 체계)

#### 4.2.3 TLS와 결합한 종합 보안 수준

```
레이어 1: TLS 1.2/1.3 + Let's Encrypt ECDSA (SSL Labs A+)
         → MITM 공격 차단, 헤더 암호화 보장

레이어 2: x-token/x-channel 커스텀 헤더 (bcrypt 해시 저장)
         → 제조사 인증 + rainbow table 공격 차단

레이어 3: 시리얼번호 화이트리스트 (사전 등록 필수)
         → 임의 시리얼 등록 차단

레이어 4: One-shot 발급 (409 재호출 차단)
         → 중복 발급 공격 차단

레이어 5: Rate Limiting (provisionRateLimiter)
         → brute-force 차단

레이어 6: Pino 구조화 감사 로그
         → 이상 접근 탐지 및 포렌식
```

---

## 섹션 5. 서버 측 처리 흐름 (시퀀스 다이어그램)

### 5.1 전체 흐름 (ASCII 시퀀스 다이어그램)

```
충전기                      Pvpentech 서버                        PostgreSQL
   |                              |                                     |
   |  POST /auths                 |                                     |
   |  x-token: <token>            |                                     |
   |  x-channel: vendor_a         |                                     |
   |  body: {origin, model}       |                                     |
   |----------------------------->|                                     |
   |                              |                                     |
   |                              |-- SELECT manufacturer               |
   |                              |   WHERE channelId='vendor_a'------->|
   |                              |<-----------------------------------  |
   |                              |   (manufacturer row)                |
   |                              |                                     |
   |                [Step 1] 헤더 검증                                  |
   |                - x-token/x-channel 존재 확인                       |
   |                - Manufacturer 조회                                  |
   |                - bcrypt.compare(x-token, tokenHash)                |
   |                - isActive 확인                                      |
   |                       |                                            |
   |                [401 실패 시]                                        |
   |<-- 401 Unauthorized --|                                            |
   |                       |                                            |
   |                [Step 2] body 형식 검증 (Zod)                       |
   |                - origin: string (required)                         |
   |                - model: string (required)                          |
   |                       |                                            |
   |                [400 실패 시]                                        |
   |<-- 400 Bad Request ---|                                            |
   |                       |                                            |
   |                [Step 3] ChargerProvisioning 조회                   |
   |                              |-- SELECT charger_provisioning ------>|
   |                              |   WHERE serialNumber=origin          |
   |                              |<------------------------------------ |
   |                              |                                     |
   |                       ┌------+------┐                             |
   |                       |  status 분기  |                             |
   |                       └------+------┘                             |
   |                              |                                     |
   |              없음(NULL) ──── |                                     |
   |<-- 404 Not Found  <--------- |                                     |
   |                              |                                     |
   |  manufacturerId != matched.id|                                     |
   |<-- 404 Not Found  <--------- |                                     |
   |                              |                                     |
   |  status='rejected'/'revoked' |                                     |
   |<-- 401 Unauthorized <------- |                                     |
   |                              |                                     |
   |  status='provisioned'        |                                     |
   |<-- 409 Conflict  <---------- |                                     |
   |                              |                                     |
   |  status='registered'   ───── |                                     |
   |                              |                                     |
   |                [Step 4] clientId 결정                              |
   |                - record.clientId 있으면 그대로 사용                  |
   |                - 없으면 generateStationId() 자동 생성               |
   |                              |-- UPSERT station_id_sequence ------>|
   |                              |<------------------------------------ |
   |                              |                                     |
   |                [Step 5] 비밀번호 생성                               |
   |                - generateRandomPassword(32) → plainPassword        |
   |                - bcrypt.hash(plainPassword) → passwordHash         |
   |                              |                                     |
   |                [Step 6] 트랜잭션                                    |
   |                              |-- BEGIN TRANSACTION ---------------->|
   |                              |-- UPSERT charging_station            |
   |                              |   (id, serialNumber, passwordHash,   |
   |                              |    modelName, status='Offline') ---->|
   |                              |-- UPDATE charger_provisioning         |
   |                              |   SET status='provisioned',           |
   |                              |       provisionedAt=NOW(),            |
   |                              |       stationId=clientId  -------->  |
   |                              |-- COMMIT ---------------------------->|
   |                              |<------------------------------------ |
   |                              |                                     |
   |                [Step 7] 200 응답 반환                               |
   |<-- 200 OK                    |                                     |
   |  {code, status, message,     |                                     |
   |   timestamp,                 |                                     |
   |   data: {clientId, pwd,      |                                     |
   |           wsUrl}}            |                                     |
   |                              |                                     |
```

### 5.2 서버 내부 처리 로직 요약

```
충전기 → POST /auths (x-token, x-channel, body)

서버:
  1. 헤더 검증 (manufacturerAuth 미들웨어)
     ├ x-token/x-channel 없음 → 401
     ├ channelId로 Manufacturer 미조회 → 401
     ├ bcrypt.compare 불일치 → 401
     └ isActive=false → 401

  2. body 형식 검증 (Zod: authsBodySchema)
     └ origin/model 없음 또는 타입 오류 → 400

  3. ChargerProvisioning.findUnique(where: { serialNumber: origin })
     ├ 없음 → 404
     ├ manufacturerId !== req.manufacturer.id → 404
     ├ status = 'rejected' or 'revoked' → 401
     ├ status = 'provisioned' → 409
     └ status = 'registered' → 계속

  4. clientId 결정
     └ record.clientId ?? generateStationId()

  5. 비밀번호 생성
     └ generateRandomPassword(32) + bcrypt.hash()

  6. 트랜잭션
     ├ ChargingStation.upsert(id=clientId, serialNumber, passwordHash, modelName)
     └ ChargerProvisioning.update(status='provisioned', provisionedAt, stationId)

  7. 응답
     └ { code:200, data: { clientId, pwd(평문), wsUrl } }
```

---

## 섹션 6. DB 스키마 변경

### 6.1 신규 테이블 — `Manufacturer`

```prisma
/// 충전기 제조사 테이블 — v2.0 신규
model Manufacturer {
  id          Int      @id @default(autoincrement())
  channelId   String   @unique @db.VarChar(50)    // x-channel 헤더 값 (CS가 부여)
  name        String   @db.VarChar(100)           // 제조사 이름 (예: "VendorA Co., Ltd.")
  tokenHash   String   @db.VarChar(255)           // bcrypt hash of x-token (평문 비저장)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  provisionings ChargerProvisioning[]

  @@index([channelId])
  @@map("manufacturer")
}
```

#### 6.1.1 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | `Int` | PK, auto increment |
| `channelId` | `String(50)` | `x-channel` 헤더 값과 1:1 매핑. CS 담당자가 제조사 등록 시 임의 부여 (예: `vendor_a`). UNIQUE 인덱스. |
| `name` | `String(100)` | 제조사 법인명 또는 브랜드명 |
| `tokenHash` | `String(255)` | CS 포털 발급 토큰의 bcrypt 해시. 평문은 저장하지 않음. |
| `isActive` | `Boolean` | `false`이면 해당 제조사의 모든 `/auths` 요청이 401 응답. 소프트 비활성화. |

### 6.2 기존 테이블 변경 — `ChargerProvisioning`

```prisma
model ChargerProvisioning {
  id              Int                 @id @default(autoincrement())
  serialNumber    String              @unique @db.VarChar(100)
  modelName       String?             @db.VarChar(100)
  clientId        String?             @unique @db.VarChar(50)
  stationId       String?             @unique @db.VarChar(50)
  status          ProvisioningStatus  @default(registered)
  registeredBy    String?             @db.VarChar(150)
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
  @@index([manufacturerId])        // v2.0 추가
  @@map("charger_provisioning")
}
```

#### 변경 내용 요약

| 변경 항목 | 설명 |
|----------|------|
| `manufacturerId Int?` 추가 | 해당 시리얼을 등록한 제조사 FK. `nullable` — 마이그레이션 직후 기존 레코드는 `NULL`. |
| `manufacturer Manufacturer?` 관계 추가 | `manufacturerId` → `Manufacturer.id` |
| `@@index([manufacturerId])` 추가 | 제조사별 시리얼 목록 조회 최적화 |
| `modelName` | 기존 존재 필드 — v2.0에서 Request body의 `model`로 채움 |

### 6.3 마이그레이션 절차

#### 6.3.1 마이그레이션 실행

```bash
# 개발 환경
npx prisma migrate dev --name add_manufacturer_table

# 운영 환경 (배포 시 별도 DBA 승인 후)
npx prisma migrate deploy
```

#### 6.3.2 마이그레이션 SQL 핵심 구문 (참고용)

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

#### 6.3.3 기존 레코드 처리 방침

| 시나리오 | 처리 방침 |
|---------|---------|
| 마이그레이션 직후 기존 레코드 | `manufacturerId = NULL` — 영향 없음 |
| `NULL` 허용 vs NOT NULL | Phase 1에서는 `nullable` 유지. Phase 4에서 일괄 매핑 후 `NOT NULL` 강화 검토 |
| 이미 `provisioned` 상태 충전기 | OCPP 운영에 영향 없음 — `manufacturerId`는 프로비저닝 이력 관리용 |
| 신규 등록 시리얼 | CS 포털에서 제조사 선택 필수 → `manufacturerId` 반드시 설정 |

---

## 섹션 7. 코드 변경 계획

### 7.1 신규 생성 파일

| 파일 경로 | 역할 |
|----------|------|
| `src/middlewares/manufacturerAuth.middleware.ts` | `x-token`/`x-channel` 헤더 검증, `req.manufacturer` 주입 |
| `src/repositories/manufacturer.repository.ts` | Manufacturer CRUD 쿼리 (Prisma 직접 호출 래퍼) |
| `src/services/manufacturer.service.ts` | 제조사 등록/조회/토큰 발급/재발급/비활성화 비즈니스 로직 |
| `src/controllers/manufacturer.controller.ts` | CS 포털 API 요청/응답 처리 |
| `src/routes/portal/cs/manufacturer.routes.ts` | 제조사 관리 라우트 등록 |
| `src/validators/manufacturer.validator.ts` | Zod 스키마: 등록/수정/재발급 요청 검증 |

#### 7.1.1 `manufacturer.repository.ts` 개요

```typescript
import { prisma } from '@config/database';
import { Prisma } from '@prisma/client';

export class ManufacturerRepository {
  findByChannelId(channelId: string) {
    return prisma.manufacturer.findUnique({ where: { channelId } });
  }

  findById(id: number) {
    return prisma.manufacturer.findUnique({ where: { id } });
  }

  create(data: Prisma.ManufacturerCreateInput) {
    return prisma.manufacturer.create({ data });
  }

  update(id: number, data: Prisma.ManufacturerUpdateInput) {
    return prisma.manufacturer.update({ where: { id }, data });
  }

  findAll(params: { page: number; limit: number }) {
    const skip = (params.page - 1) * params.limit;
    return Promise.all([
      prisma.manufacturer.findMany({ skip, take: params.limit, orderBy: { createdAt: 'desc' } }),
      prisma.manufacturer.count(),
    ]);
  }
}

export const manufacturerRepository = new ManufacturerRepository();
```

#### 7.1.2 `manufacturer.service.ts` 토큰 발급 로직

```typescript
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { ManufacturerRepository } from '@repositories/manufacturer.repository';
import { ConflictError, NotFoundError } from '@utils/errors';

export class ManufacturerService {
  constructor(private repo: ManufacturerRepository) {}

  /**
   * 제조사 등록 + x-token 신규 발급
   * @returns 평문 토큰을 포함한 결과 (1회만 반환)
   */
  async create(data: { channelId: string; name: string }): Promise<{ manufacturer: any; plainToken: string }> {
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

    return { manufacturer, plainToken };
  }

  /**
   * 토큰 재발급 — 기존 tokenHash 교체
   * @returns 새 평문 토큰 (1회만 반환)
   */
  async regenerateToken(id: number): Promise<{ plainToken: string }> {
    const manufacturer = await this.repo.findById(id);
    if (!manufacturer) throw new NotFoundError('제조사를 찾을 수 없습니다.');

    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash  = await bcrypt.hash(plainToken, 12);

    await this.repo.update(id, { tokenHash });
    return { plainToken };
  }

  // ... 기타 CRUD 메서드
}
```

### 7.2 변경 파일

#### 7.2.1 `src/controllers/provision.controller.ts` (chargerAuth 메서드)

**변경 포인트 (line 97-148):**

```typescript
// Before (v1.x)
const schema = z.object({
  origin: z.string().min(1).max(100),
  model:  z.string().max(100).optional(),   // optional
});

// After (v2.0)
const schema = z.object({
  origin: z.string().min(1).max(100),
  model:  z.string().min(1).max(100),       // required
});
```

**서비스 호출 시 manufacturer 정보 전달:**

```typescript
chargerAuth = async (req: Request, res: Response): Promise<void> => {
  const manufacturer = (req as any).manufacturer; // manufacturerAuth 미들웨어에서 주입

  const parseResult = authsBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ code: 400, status: 'Bad Request', message: '요청 형식이 올바르지 않습니다.', errors: null });
    return;
  }

  const { origin, model } = parseResult.data;

  try {
    const result = await this.provisionService.provision(origin, model, manufacturer.id);
    // ...
  } catch (error) {
    // 오류 처리 (기존과 동일)
  }
};
```

#### 7.2.2 `src/services/provision.service.ts` (provision 메서드)

**변경 포인트:** `manufacturerId` 검증 추가

```typescript
// v2.0: manufacturerId 파라미터 추가
async provision(serialNumber: string, model: string, manufacturerId: number): Promise<ProvisionResult> {
  const record = await prisma.chargerProvisioning.findUnique({
    where: { serialNumber },
  });

  // 기존 체크
  if (!record || record.status === 'rejected' || record.status === 'revoked') {
    throw new ForbiddenError('등록되지 않은 충전기입니다.', 'station:provisionRejected');
  }

  // v2.0 신규: 제조사 채널 매핑 확인
  if (record.manufacturerId !== null && record.manufacturerId !== manufacturerId) {
    logger.warn({ serialNumber, manufacturerId }, 'Provision rejected: manufacturer mismatch');
    throw new NotFoundError('등록되지 않은 충전기입니다.');  // 보안: 구체적 사유 미노출
  }

  if (record.status === 'provisioned') {
    throw new ConflictError('이미 프로비저닝이 완료된 충전기입니다.', 'station:alreadyProvisioned');
  }

  // 이하 기존 로직 동일 (clientId 결정, 비밀번호 생성, 트랜잭션)
  // ...
}
```

#### 7.2.3 `src/routes/index.ts` (line 128 부근)

```typescript
// Before (v1.x)
router.post('/auths', provisionRateLimiter, provisionController.chargerAuth);

// After (v2.0)
import { manufacturerAuth } from '@middlewares/manufacturerAuth.middleware';

router.post('/auths', provisionRateLimiter, manufacturerAuth, provisionController.chargerAuth);
```

#### 7.2.4 `prisma/schema.prisma`

- `Manufacturer` 모델 추가 (6.1 참조)
- `ChargerProvisioning`에 `manufacturerId`, `@@index([manufacturerId])` 추가 (6.2 참조)

#### 7.2.5 Swagger 문서 업데이트

`/auths` 엔드포인트 Swagger 주석 변경:

```typescript
/**
 * @swagger
 * /auths:
 *   post:
 *     summary: 충전기 프로비저닝
 *     tags: [Provisioning]
 *     security: []  # v2.0: Basic Auth 제거
 *     parameters:
 *       - in: header
 *         name: x-token
 *         required: true
 *         schema:
 *           type: string
 *         description: 제조사 인증 토큰 (CS 포털에서 발급)
 *       - in: header
 *         name: x-channel
 *         required: true
 *         schema:
 *           type: string
 *         description: 제조사 채널 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [origin, model]
 *             properties:
 *               origin:
 *                 type: string
 *                 description: 충전기 시리얼번호
 *               model:
 *                 type: string
 *                 description: 충전기 모델명 (v2.0부터 필수)
 */
```

#### 7.2.6 다국어 메시지 (locales)

**`locales/ko/provisioning.json` (신규/추가)**

```json
{
  "provisionSuccess": "프로비저닝이 완료되었습니다.",
  "provisionRejected": "등록되지 않은 충전기입니다.",
  "alreadyProvisioned": "이미 프로비저닝이 완료된 충전기입니다.",
  "authHeaderMissing": "인증 헤더가 없습니다.",
  "authFailed": "인증에 실패하였습니다.",
  "manufacturerNotFound": "등록되지 않은 제조사입니다.",
  "manufacturerInactive": "비활성화된 제조사 채널입니다.",
  "invalidBody": "요청 형식이 올바르지 않습니다."
}
```

**`locales/en/provisioning.json`**

```json
{
  "provisionSuccess": "Provisioning completed successfully.",
  "provisionRejected": "Unregistered charging station.",
  "alreadyProvisioned": "This station has already been provisioned.",
  "authHeaderMissing": "Authentication headers are missing.",
  "authFailed": "Authentication failed.",
  "manufacturerNotFound": "Unregistered manufacturer.",
  "manufacturerInactive": "Manufacturer channel is inactive.",
  "invalidBody": "Invalid request format."
}
```

**`locales/vi/provisioning.json`**

```json
{
  "provisionSuccess": "Cấp phép hoàn tất thành công.",
  "provisionRejected": "Trạm sạc chưa được đăng ký.",
  "alreadyProvisioned": "Trạm sạc này đã được cấp phép rồi.",
  "authHeaderMissing": "Thiếu tiêu đề xác thực.",
  "authFailed": "Xác thực thất bại.",
  "manufacturerNotFound": "Nhà sản xuất chưa được đăng ký.",
  "manufacturerInactive": "Kênh nhà sản xuất không hoạt động.",
  "invalidBody": "Định dạng yêu cầu không hợp lệ."
}
```

### 7.3 환경 변수

```bash
# 기존 변수 — 확인만 필요
CSMS_SERVER_URL=wss://pvpentech.kr   # provision.service.ts에서 wsUrl로 반환

# v2.0 신규 환경 변수 없음
# x-token/x-channel은 DB에서 동적 관리 (환경 변수 방식 사용 안 함)
```

---

## 섹션 8. CS 포털 — 제조사 관리 API

### 8.1 엔드포인트 일람

| Method | 경로 | 설명 | 응답 특이사항 |
|--------|------|------|-------------|
| `GET` | `/api/portal/cs/manufacturers` | 제조사 목록 조회 (페이지네이션) | - |
| `POST` | `/api/portal/cs/manufacturers` | 제조사 등록 + 토큰 발급 | 응답에 `plainToken` 1회 포함 |
| `GET` | `/api/portal/cs/manufacturers/:id` | 제조사 상세 조회 | `tokenHash` 미포함 |
| `PUT` | `/api/portal/cs/manufacturers/:id` | 제조사 정보 수정 (`name`, `isActive`) | - |
| `POST` | `/api/portal/cs/manufacturers/:id/regenerate-token` | 토큰 재발급 | 응답에 `plainToken` 1회 포함 |
| `DELETE` | `/api/portal/cs/manufacturers/:id` | 비활성화 (소프트 삭제) | `isActive=false` 처리 |

### 8.2 제조사 등록 API 상세

#### Request

```http
POST /api/portal/cs/manufacturers
Authorization: Bearer <cs_admin_token>
Content-Type: application/json

{
  "channelId": "vendor_a",
  "name": "VendorA Co., Ltd."
}
```

#### Response 201

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

### 8.3 토큰 재발급 API

```http
POST /api/portal/cs/manufacturers/1/regenerate-token
Authorization: Bearer <cs_admin_token>
```

```json
{
  "success": true,
  "data": {
    "plainToken": "b4e8c3d2e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0b2"
  },
  "notice": "기존 토큰은 즉시 무효화됩니다. 제조사에 새 토큰을 전달하세요."
}
```

### 8.4 시리얼번호 등록 API 변경

**기존 `POST /api/portal/cs/provisioning`에 `manufacturerId` 필드 추가.**

```typescript
// 기존 registerSchema (provision.controller.ts)
const registerSchema = z.object({
  serialNumber: z.string().min(1).max(100),
  modelName:    z.string().max(100).optional(),
  clientId:     z.string().max(50).optional(),
  siteId:       z.number().int().positive().optional(),
  // v2.0 추가:
  manufacturerId: z.number().int().positive(),  // 필수
});
```

Request 예시:

```json
{
  "serialNumber": "CP-VDA-00123",
  "modelName": "VDA-7kW-AC01",
  "manufacturerId": 1
}
```

---

## 섹션 9. CS 포털 UI 변경 사항

### 9.1 제조사 관리 화면 (신규)

#### 목록 화면

| 컬럼 | 설명 |
|------|------|
| 채널 ID | `channelId` |
| 제조사명 | `name` |
| 상태 | `isActive` (활성/비활성 배지) |
| 등록일 | `createdAt` |
| 액션 | 수정 / 토큰 재발급 / 비활성화 버튼 |

#### 토큰 발급 후 1회 표시 모달

```
┌─────────────────────────────────────────────────────┐
│  제조사 등록 완료 — x-token 발급                       │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7...   │   │
│  └─────────────────────────────────────────────┘   │
│                      [복사]                          │
│                                                     │
│  ⚠ 이 화면을 닫으면 토큰을 다시 확인할 수 없습니다.    │
│     지금 바로 복사하여 제조사에 안전하게 전달하세요.    │
│                                                     │
│                   [확인 (닫기)]                       │
└─────────────────────────────────────────────────────┘
```

### 9.2 시리얼번호 등록 화면 변경

#### 단건 등록

- 기존 필드 유지
- **신규 필드**: 제조사 선택 (드롭다운 — Manufacturer 목록에서 선택, 필수)

#### CSV 일괄 등록

기존 CSV 형식에 `manufacturerChannelId` 컬럼 추가:

| 기존 컬럼 | v2.0 추가 컬럼 |
|----------|-------------|
| `serialNumber`, `modelName`, `clientId`, `siteId` | `manufacturerChannelId` (예: `vendor_a`) |

CSV 예시:

```csv
serialNumber,modelName,clientId,siteId,manufacturerChannelId
CP-VDA-00123,VDA-7kW-AC01,,1,vendor_a
CP-VDA-00124,VDA-7kW-AC01,,1,vendor_a
CP-VDB-00001,VDB-22kW-DC01,,2,vendor_b
```

---

## 섹션 10. 충전기 제조사 전달용 가이드

### 01. OCPP 서버 접속 정보

| 항목 | 값 |
|------|-----|
| 프로토콜 | OCPP 1.6J (JSON over WebSocket) |
| 호스트 | `wss://pvpentech.kr` |
| 접속 경로 형식 | `wss://pvpentech.kr/ocpp/<clientId>` |
| 보안 프로파일 | Security Profile 1 (TLS + OCPP Basic Auth) |
| TLS 버전 | TLS 1.2 / TLS 1.3 |
| Sub-Protocol | `ocpp1.6` |
| Auth 헤더 | `Authorization: Basic base64(<clientId>:<pwd>)` |

OCPP 접속 예시 (clientId: `EN1000001`, pwd: `xK9mP2...`):

```
URL:  wss://pvpentech.kr/ocpp/EN1000001
Header:
  Authorization: Basic RU4xMDAwMDAxOnhLOW1QMnFS...  (base64)
  Sec-WebSocket-Protocol: ocpp1.6
```

---

### 02. `/auths` 프로비저닝 엔드포인트

| 항목 | 값 |
|------|-----|
| 호스트 | `https://pvpentech.kr` |
| 경로 | `POST /auths` |
| Content-Type | `application/json` |
| 인증 헤더 | `x-token`, `x-channel` (CS 담당자가 발급하여 전달) |

#### 필수 헤더

| 헤더 | 설명 | 예시 |
|------|------|------|
| `x-token` | CS가 제조사에 발급한 64자 hex 토큰 | `x-token: a3f9b2c1...` |
| `x-channel` | CS가 부여한 제조사 채널 ID | `x-channel: vendor_a` |

#### Request Body

```json
{
  "origin": "<충전기 시리얼번호>",
  "model":  "<충전기 모델명>"
}
```

#### 성공 응답 (200)

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

#### 오류 응답

| HTTP 코드 | 의미 | 펌웨어 처리 권장 |
|----------|------|--------------|
| 400 | 요청 형식 오류 | body 재확인 후 재시도 |
| 401 | 인증 실패 | CS 담당자에게 토큰 재발급 요청 |
| 404 | 시리얼 미등록 | CS 담당자에게 시리얼 사전 등록 요청 |
| 409 | 이미 프로비저닝됨 | 저장된 `clientId`/`pwd` 사용. 분실 시 CS에 reset 요청 |
| 500 | 서버 오류 | 일정 시간 후 재시도 (지수 백오프 권장) |

---

### 03. 충전기 펌웨어 권장 흐름

#### Phase 1 — Provisioning (최초 설치)

```
전원 인가
    │
    ▼
비휘발성 스토리지에 clientId/pwd 존재?
    ├─ YES → Phase 2로 이동 (이미 프로비저닝됨)
    └─ NO  → ▼

POST /auths 호출
    ├─ 200 → clientId, pwd, wsUrl 수신
    │         비휘발성 스토리지에 저장
    │         → Phase 2로 이동
    ├─ 409 → 이미 프로비저닝됨 (분실 케이스)
    │         CS 포털 reset 대기
    ├─ 401/404 → 토큰/시리얼 문제
    │            오류 로그 기록 + 관리자 알림
    └─ 500 → 지수 백오프 후 재시도 (최대 5회)
```

#### Phase 2 — OCPP 운영 접속

```
wsUrl + clientId로 WebSocket URL 구성
wss://pvpentech.kr/ocpp/<clientId>

OCPP Basic Auth 헤더 추가:
  Authorization: Basic base64(<clientId>:<pwd>)

WebSocket 연결
    ├─ 101 Switching Protocols → BootNotification 전송
    └─ 401/403 → pwd 만료 또는 reset됨 → Phase 1 재시작
```

#### 재시도 정책 권장

```
첫 번째 실패: 30초 후 재시도
두 번째 실패: 60초 후 재시도
세 번째 실패: 120초 후 재시도
이후: 300초 간격으로 유지 (최대 재시도 횟수: 제조사 정책에 따름)
```

---

## 섹션 11. 보안 고려사항

### 11.1 위협 모델

| 위협 | 공격 시나리오 | 심각도 |
|------|-------------|-------|
| **토큰 유출** | 제조사 내부 직원/시스템에서 `x-token` 유출 | 중 |
| **시리얼 열거 (Enumeration)** | 유효한 `x-token`/`x-channel`로 시리얼 brute-force | 중 |
| **MITM** | TLS 미검증 클라이언트에서 헤더 가로채기 | 낮음 (TLS로 완화) |
| **재발급 공격** | reset 후 무한 재프로비저닝 | 낮음 (CS 권한 필요) |
| **제조사 토큰 공유** | 동일 x-channel 다수 장치가 동일 토큰 공유 | 낮음 (정책 문제) |

### 11.2 대응 장치

| 위협 | 대응 장치 | 구현 위치 |
|------|---------|---------|
| 토큰 유출 | bcrypt 해시 저장 (cost factor 12) | `manufacturer.service.ts` |
| 토큰 유출 범위 | 제조사별 독립 토큰 (`x-channel`) | `Manufacturer` 테이블 |
| 시리얼 열거 | 404 응답 메시지 통일 (구체적 사유 미노출) | `provision.service.ts` |
| 시리얼 열거 | Rate Limiting (`provisionRateLimiter`) | `src/routes/index.ts` |
| MITM | TLS 1.2/1.3 + Let's Encrypt ECDSA | AWS ALB / Nginx |
| 중복 발급 | One-shot 정책 (409) | `provision.service.ts` |
| 이상 접근 | Pino 구조화 감사 로그 (`x-channel`, `origin`, IP) | `provision.controller.ts` |
| 비활성화 | `isActive=false` 즉시 차단 | `manufacturerAuth.middleware.ts` |

### 11.3 향후 강화 옵션

| 옵션 | 설명 | 우선순위 |
|------|------|--------|
| **도메인 분리** | `auth.pvpentech.kr` → `/auths` 전용 서브도메인 분리. 포트/WAF 정책 독립. | 중 |
| **mTLS (Security Profile 3)** | OCPP 접속에 클라이언트 인증서 도입. 충전기 하드웨어에 인증서 주입 필요. | 낮음 (장기) |
| **토큰 정기 Rotation** | 6개월/1년 단위 `x-token` 재발급 의무화. CS 포털 만료일 관리. | 중 |
| **IP 화이트리스트** | 제조사 공장 IP 대역만 `/auths` 허용. Nginx/ALB ACL 또는 미들웨어 처리. | 낮음 |
| **HMAC 서명 검증** | body에 HMAC-SHA256 서명 추가. 재전송 공격 차단. | 낮음 |

---

## 섹션 12. 마이그레이션 / 롤아웃 계획

### 12.1 단계별 적용

```
Phase 1: DB 스키마 확장
─────────────────────
목표: Manufacturer 테이블 추가, 기존 기능 영향 없음
작업:
  - prisma/schema.prisma에 Manufacturer 모델 추가
  - ChargerProvisioning에 manufacturerId (nullable) 추가
  - npx prisma migrate dev --name add_manufacturer_table
  - 기존 /auths 동작 변경 없음 (manufacturerId=null 허용)
검증: prisma studio에서 테이블 생성 확인

Phase 2: 제조사 관리 API 개발
──────────────────────────
목표: CS 포털에서 제조사 등록/토큰 발급 가능
작업:
  - manufacturer.repository / service / controller / routes 구현
  - CS 포털 UI 제조사 관리 화면 개발
  - 제조사 등록 후 x-token/x-channel 테스트 환경 검증
검증: Postman으로 /auths에 x-token/x-channel 헤더 포함 테스트

Phase 3: /auths 미들웨어 적용 (테스트 환경)
─────────────────────────────────────────
목표: manufacturerAuth 미들웨어를 /auths에 적용, 테스트 환경에서 검증
작업:
  - manufacturerAuth.middleware.ts 구현
  - src/routes/index.ts 미들웨어 적용
  - model 필드 required 강화 (Zod schema 수정)
  - 통합 테스트 전체 실행
검증: 모든 오류 시나리오 (400/401/404/409/500) 검증 완료

Phase 4: 운영 적용
─────────────────
목표: 운영 환경 배포, 신규 충전기부터 v2.0 프로비저닝 적용
작업:
  - 운영 DB 마이그레이션 (npx prisma migrate deploy)
  - 제조사별 x-token/x-channel 사전 발급 (CS 담당자)
  - 제조사에 v2.0 가이드 문서 전달
  - 기존 ChargerProvisioning 레코드에 manufacturerId 일괄 매핑
검증: 파일럿 제조사 1개사 실제 프로비저닝 테스트

Phase 5: 기존 레코드 정리 (선택)
───────────────────────────────
목표: manufacturerId=null 레코드 해소
작업:
  - 제조사 매핑 완료 후 manufacturerId NOT NULL 마이그레이션 검토
  - 미매핑 레코드 처리 정책 결정 (기본 제조사 지정 or 수동 처리)
```

### 12.2 기존 충전기 영향

| 항목 | 영향 | 비고 |
|------|------|------|
| 이미 OCPP 운영 중인 충전기 | **없음** | OCPP Basic Auth는 별도 체계, 변경 불필요 |
| 이미 `provisioned` 상태 충전기 | **없음** | 재프로비저닝 불필요 |
| 기존 `registered` 상태 충전기 | Phase 3 이후 `/auths` 재호출 시 미들웨어 적용 | `manufacturerId=null`이면 서비스 로직에서 별도 처리 필요 |
| 신규 등록 시리얼 | Phase 2 이후 `manufacturerId` 필수 | CS 포털 UI 변경으로 자동 처리 |

---

## 섹션 13. 테스트 계획

### 13.1 단위 테스트

#### `manufacturerAuth.middleware.ts` 테스트 케이스

```typescript
describe('manufacturerAuth middleware', () => {
  test('x-token 없으면 401');
  test('x-channel 없으면 401');
  test('존재하지 않는 channelId → 401');
  test('tokenHash bcrypt 불일치 → 401');
  test('isActive=false → 401');
  test('정상 토큰/채널 → next() 호출 + req.manufacturer 주입');
});
```

#### `provision.service.ts` 제조사 매핑 로직 테스트

```typescript
describe('provision service - manufacturer matching', () => {
  test('manufacturerId 일치 → 정상 프로비저닝');
  test('manufacturerId 불일치 → NotFoundError');
  test('manufacturerId=null (레거시 레코드) → 정책에 따라 허용 or 거부');
  test('status=rejected → ForbiddenError');
  test('status=provisioned → ConflictError');
});
```

### 13.2 통합 테스트 시나리오

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
| T12 | `status=rejected` 시리얼 | 401 (ForbiddenError → 401) |
| T13 | CS reset 후 재프로비저닝 | 200 |
| T14 | 응답 `wsUrl`로 OCPP 접속 성공 | WebSocket 101 |

### 13.3 테스트 HTTP Request 예시

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

# T10 — model 필드 누락 (v2.0 신규 체크)
curl -X POST https://localhost:3000/auths \
  -H "Content-Type: application/json" \
  -H "x-token: a3f9b2c1d4e5..." \
  -H "x-channel: vendor_a" \
  -d '{"origin": "CP-VDA-00123"}'
```

---

## 섹션 14. 체크리스트 (구현 시 참조)

### DB / Prisma

- [ ] `prisma/schema.prisma`에 `Manufacturer` 모델 추가
- [ ] `ChargerProvisioning`에 `manufacturerId Int?` FK 추가
- [ ] `ChargerProvisioning`에 `@@index([manufacturerId])` 추가
- [ ] `npx prisma migrate dev --name add_manufacturer_table` 실행
- [ ] `npx prisma generate` 실행

### 제조사 관리 기능

- [ ] `src/repositories/manufacturer.repository.ts` 구현
- [ ] `src/validators/manufacturer.validator.ts` Zod 스키마 작성
- [ ] `src/services/manufacturer.service.ts` CRUD + 토큰 발급/재발급 구현
- [ ] `src/controllers/manufacturer.controller.ts` 구현
- [ ] `src/routes/portal/cs/manufacturer.routes.ts` 등록

### `/auths` 미들웨어 및 라우트

- [ ] `src/middlewares/manufacturerAuth.middleware.ts` 구현
- [ ] `provision.controller.ts:chargerAuth` — `authsBodySchema`에서 `model` 필수화
- [ ] `provision.service.ts:provision` — `manufacturerId` 파라미터 추가 및 매핑 검증
- [ ] `src/routes/index.ts` — `/auths` 라우트에 `manufacturerAuth` 미들웨어 추가

### Swagger / 문서

- [ ] `/auths` Swagger 주석 — `basicAuth` 제거, `x-token`/`x-channel` 헤더 파라미터 추가
- [ ] `model` 필드 `required` 반영
- [ ] 오류 응답 코드표 업데이트

### CS 포털

- [ ] 시리얼 등록 API (`provision.controller.register`)에 `manufacturerId` 필수 추가
- [ ] CS 포털 제조사 관리 화면 구현 (목록/등록/수정/토큰 재발급)
- [ ] CS 포털 시리얼 등록 화면에 제조사 선택 필드 추가
- [ ] CSV 일괄 등록에 `manufacturerChannelId` 컬럼 추가

### 다국어

- [ ] `locales/ko/provisioning.json` — 신규 메시지 추가
- [ ] `locales/en/provisioning.json` — 신규 메시지 추가
- [ ] `locales/vi/provisioning.json` — 신규 메시지 추가

### 테스트

- [ ] `manufacturerAuth` 미들웨어 단위 테스트
- [ ] `provision.service` 제조사 매핑 단위 테스트
- [ ] 통합 테스트 T01~T14 전체 실행
- [ ] Rate Limit 동작 확인

### 배포 준비

- [ ] 충전기 제조사 가이드 문서 발행 (섹션 10 기반)
- [ ] CS 담당자에게 제조사 등록 및 토큰 발급 절차 교육
- [ ] 운영 DB 마이그레이션 계획 수립 (DBA 확인)
- [ ] 기존 ChargerProvisioning 레코드 `manufacturerId` 일괄 매핑 스크립트 준비
- [ ] 운영 배포 후 Pino 로그에서 `/auths` 요청 모니터링

---

## 섹션 15. 부록

### 15.1 기존 `12_charger_provisioning.md` 업데이트 항목 (v2.0)

이번 명세를 기반으로 `documents/design_guide/12_charger_provisioning.md`를 다음 내용으로 업데이트해야 한다.

| 항목 | 변경 내용 |
|------|---------|
| 버전 표기 | v1.1 → v2.0 |
| 인증 방식 섹션 | Basic Auth → `x-token`/`x-channel` 커스텀 헤더로 교체 |
| DB 스키마 | `Manufacturer` 테이블 추가, `ChargerProvisioning.manufacturerId` 추가 |
| 시퀀스 다이어그램 | 제조사 인증 단계 추가 |
| Request Body | `model` 필드 optional → required |
| 응답 코드 표 | 401 구분 명확화 (헤더 검증 vs 상태 오류) |
| 코드 예시 | `chargerAuth` 컨트롤러, `provision` 서비스 v2.0 버전으로 교체 |

---

### 15.2 PlugLink 명세와의 비교표

| 항목 | PlugLink | Pvpentech v2.0 |
|------|---------|----------------|
| 인증 방식 | `x-token` + `x-channel` | `x-token` + `x-channel` (동일 채택) |
| 운영 도메인 | `wss://connector.pluglink.kr` | `wss://pvpentech.kr` |
| Provisioning 도메인 | `https://matt.pluglink.kr/auths` (분리) | `https://pvpentech.kr/auths` (단일 유지) |
| Request Body | `{ origin }` | `{ origin, model }` — **model 추가** |
| 응답 `wsUrl` | 없음 | **있음** — 충전기가 동적으로 wsUrl 수신 |
| 응답 형식 | `{ code, status, message, timestamp, data }` | 동일 (채택) |
| 오류 코드 | 400/401/404/500 | 400/401/**404/409**/500 — **409 추가** |
| One-shot 정책 | 명시 없음 | 409 명시적 추가 |
| 제조사 DB 관리 | 알 수 없음 | CS 포털에서 CRUD + 토큰 관리 |
| 다국어 지원 | 알 수 없음 | ko/en/vi 3개 언어 메시지 |

---

### 15.3 토큰 발급/관리 운영 가이드 (CS 담당자용)

#### 토큰 발급 시 주의사항

1. **1회 표시 원칙**: `plainToken`은 API 응답 또는 포털 모달에서 1회만 표시된다. 반드시 복사 후 제조사 담당자에게 안전한 채널(암호화 이메일, 사내 비밀번호 관리 도구)로 전달한다.
2. **제조사별 독립 채널**: 동일 토큰을 여러 제조사에 공유하지 않는다. 제조사마다 고유한 `channelId`와 `x-token`을 발급한다.
3. **채널 ID 명명 규칙**: `vendor_<약어>` 형식 권장 (예: `vendor_a`, `vendor_samsung`). 특수문자 없이 소문자+언더스코어만 사용.

#### 분실 시 재발급 절차

```
1. CS 포털 → 제조사 관리 → 해당 제조사 선택
2. "토큰 재발급" 버튼 클릭
3. 새 plainToken 1회 표시 → 복사
4. 기존 토큰은 즉시 무효화됨
5. 제조사에 새 토큰 전달 (펌웨어 업데이트 또는 원격 설정 필요)
```

> 재발급 즉시 기존 토큰으로 진행 중인 프로비저닝은 401로 거부된다. 제조사와 재발급 타이밍을 사전 조율할 것.

#### 제조사 비활성화 절차

```
1. CS 포털 → 제조사 관리 → 해당 제조사 → "비활성화" 클릭
2. isActive=false 즉시 적용
3. 해당 channelId의 /auths 요청 전부 401 거부
4. 이미 provisioned 충전기의 OCPP 운영에는 영향 없음
```

#### 제조사 협업 흐름 요약

```
CS 담당자                    제조사 펌웨어 개발팀
    │                               │
    │── 제조사 등록 (CS 포털) ────►  │
    │── x-token, x-channel 전달 ──► │
    │                               │
    │◄── 시리얼번호 목록 수신 ────── │
    │── 시리얼번호 사전 등록 ─────►  │
    │                               │
    │◄── 충전기 출하 알림 ─────────  │
    │                               │
    │   (충전기 현장 설치)            │
    │   (전원 인가 → /auths 자동 호출)│
    │                               │
    │◄── 프로비저닝 완료 확인 ──────  │ (CS 포털에서 status=provisioned 확인)
```

---

*문서 끝. 본 명세는 `documents/design_guide/12_charger_provisioning.md` v2.0 업데이트의 기준 문서로 사용된다.*
