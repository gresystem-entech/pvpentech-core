# 충전기 제조사 전달용 — 서버 연동 가이드 (공통)

| 항목 | 내용 |
|------|------|
| 문서 제목 | Pvpentech 충전기 서버 연동 가이드 |
| 버전 | v2.0 |
| 작성일 | 2026-05-07 |
| 작성자 | Pvpentech CS팀 |
| 대상 | 충전기 제조사 펌웨어 개발팀 |

---

## 목차

1. [OCPP 서버 접속 정보](#01-ocpp-서버-접속-정보)
2. [충전기 ID / PASSWORD 발급 (`/auths`)](#02-충전기-id--password-발급)
3. [충전기 펌웨어 권장 흐름](#03-충전기-펌웨어-권장-흐름)
4. [보안 권고사항](#04-보안-권고사항-제조사-펌웨어-측)
5. [문의 및 지원](#05-문의-및-지원)
6. [부록](#06-부록)

---

## 01. OCPP 서버 접속 정보

### 1. 프로토콜

```
OCPP 1.6J (JSON over WebSocket)
```

### 2. 호스트

| 사업자명 | 분류 | URL | 운영 여부 |
|---------|------|-----|----------|
| Pvpentech | 운영 서버 | `wss://pvpentech.kr` | 운영 중 |

### 3. Security Profile

**Security Profile 1** 적용:

- TLS 1.2 / TLS 1.3
- 서버 인증서: Let's Encrypt ECDSA (ISRG Root X1/X2)
- OCPP Basic Auth (HTTP Basic Authentication over WebSocket Upgrade)

### 4. 접속 헤더

WebSocket Upgrade 요청 시 다음 헤더를 반드시 포함해야 합니다.

| 헤더 | 필수 | 설명 |
|------|------|------|
| `Authorization` | 필수 | `Basic <base64(clientId:pwd)>` |
| `Sec-WebSocket-Protocol` | 필수 | `ocpp1.6` |

#### `Authorization` 헤더 생성 방법

```
1. clientId와 pwd를 콜론(:)으로 결합
   combined = clientId + ":" + pwd
   예) "EN1000001:xK9mP2qR7vL4nJ8sT1wY5oU6eA3bC0dF"

2. base64 인코딩
   encoded = base64(combined)
   예) "RU4xMDAwMDAxOnhLOW1QMnFSN3ZMNGtK..."

3. 헤더 조합
   Authorization: Basic RU4xMDAwMDAxOnhLOW1QMnFSN3ZMNGtK...
```

### 5. 접속 경로

충전기는 `/auths` 응답으로 수신한 `wsUrl`과 `clientId`를 조합하여 WebSocket 접속 경로를 구성합니다.

```
wsUrl    = "wss://pvpentech.kr"   (data.wsUrl 응답값)
clientId = "EN1000001"             (data.clientId 응답값)

접속 URL (두 형식 모두 지원):
  - wss://pvpentech.kr/EN1000001           (형식 A)
  - wss://pvpentech.kr/ocpp/EN1000001      (형식 B, 권장)
```

### 6. 접속 예시

```
URL:     wss://pvpentech.kr/ocpp/EN1000001
Headers:
  Authorization:          Basic RU4xMDAwMDAxOnhLOW1QMnFS...
  Sec-WebSocket-Protocol: ocpp1.6
```

HTTP Upgrade 요청 전체 예시:

```http
GET /ocpp/EN1000001 HTTP/1.1
Host: pvpentech.kr
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Protocol: ocpp1.6
Sec-WebSocket-Version: 13
Authorization: Basic RU4xMDAwMDAxOnhLOW1QMnFS...
```

---

## 02. 충전기 ID / PASSWORD 발급

충전기 최초 설치 시 `POST /auths` 엔드포인트를 호출하여 OCPP 접속에 필요한 `clientId`와 `pwd`를 발급받습니다.

### 1. 호스트

| 사업자명 | 분류 | URL | 운영 여부 |
|---------|------|-----|----------|
| Pvpentech | 운영 서버 | `https://pvpentech.kr/auths` | 운영 중 |

### 2. 인증 헤더

| 헤더 이름 | 필수 | 설명 |
|----------|------|------|
| `x-token` | 필수 | 제조사 인증 토큰 (Pvpentech CS 담당자가 발급하여 제조사에 전달) |
| `x-channel` | 필수 | 제조사 채널 ID (Pvpentech CS 담당자가 부여) |
| `Content-Type` | 필수 | `application/json` |

> `x-token`과 `x-channel`은 제조사별로 발급됩니다. 발급 받지 못한 경우 Pvpentech CS 담당자에게 문의하십시오.

### 3. Request Body

| 키(key) | 타입 | 필수 | 설명 | 예시 |
|--------|------|------|------|------|
| `origin` | String | 필수 | 시리얼번호 — 제조사가 장비에 부여한 고유 식별자 (모뎀번호 사용 가능) | `"CP-VDA-00123"` |
| `model` | String | 필수 | 충전기 모델명 | `"VDA-7kW-AC01"` |

요청 예시 JSON:

```json
{
  "origin": "CP-VDA-00123",
  "model":  "VDA-7kW-AC01"
}
```

HTTP Request 전체 예시:

```http
POST /auths HTTP/1.1
Host: pvpentech.kr
Content-Type: application/json
x-token: a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
x-channel: vendor_a

{
  "origin": "CP-VDA-00123",
  "model":  "VDA-7kW-AC01"
}
```

cURL 예시:

```bash
curl -X POST https://pvpentech.kr/auths \
  -H "Content-Type: application/json" \
  -H "x-token: a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1" \
  -H "x-channel: vendor_a" \
  -d '{
    "origin": "CP-VDA-00123",
    "model":  "VDA-7kW-AC01"
  }'
```

### 4. 응답

#### a. 성공 (HTTP 200)

응답 필드:

| 필드 | 타입 | 설명 |
|------|------|------|
| `code` | Number | HTTP 상태 코드 (200) |
| `status` | String | `"OK"` |
| `message` | String | 결과 메시지 |
| `timestamp` | String | 서버 처리 시각 (KST, `YYYY-MM-DD HH:mm:ss` 형식) |
| `data.clientId` | String | 발급된 충전기 식별자 (`EN` + 7자리 숫자). OCPP 접속 경로에 사용. |
| `data.pwd` | String | OCPP Basic Auth용 비밀번호 (32자 랜덤). **이 응답에서만 평문 확인 가능** — 반드시 비휘발성 저장소에 저장할 것. |
| `data.wsUrl` | String | OCPP WebSocket 서버 기본 URL. `/<clientId>` 또는 `/ocpp/<clientId>`를 붙여 접속 경로 구성. |

성공 응답 예시:

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

> **주의**: `data.pwd`는 이 응답에서만 평문으로 제공됩니다. 서버에는 암호화된 값만 저장되므로 이후 재조회가 불가능합니다. 수신 즉시 비휘발성 저장소(플래시 메모리 등)에 안전하게 저장하십시오.

#### b. 실패 응답

**400 Bad Request — 요청 형식 오류**

`origin` 또는 `model` 필드가 누락되었거나 형식이 잘못된 경우.

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

**401 Unauthorized — 인증 실패**

`x-token` 또는 `x-channel` 헤더가 없거나 토큰이 유효하지 않은 경우.

```json
{
  "code": 401,
  "status": "Unauthorized",
  "message": "인증에 실패하였습니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

**404 Not Found — 시리얼 미등록 또는 채널 불일치**

`origin`(시리얼번호)이 Pvpentech 시스템에 사전 등록되지 않은 경우.

```json
{
  "code": 404,
  "status": "Not Found",
  "message": "등록되지 않은 충전기입니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

**(2026-05-08 정책 변경) 동일 시리얼 재호출 시 idempotent re-provisioning**

동일 시리얼번호로 다시 `/auths` 를 호출하면 **기존 `clientId` 는 그대로 유지되고 `pwd` 만 새로 발급**됩니다 (One-shot 정책 폐기). 응답은 200 OK 로 신규 발급과 동일한 형식.

운영 시나리오:
- 충전기 교체: 같은 시리얼 박힌 새 기기 부팅 → `/auths` → 새 `pwd` 수신 → OCPP 접속하면 즉시 운영 재개. 구 기기의 `pwd` 는 즉시 무효화되며, OCPP WebSocket 도 자동으로 강제 종료됨.
- 펌웨어 비휘발성 저장소 분실(공장 초기화 등): 다시 부팅 시 자동으로 새 `pwd` 발급 — CS 담당자 reset 요청 불필요.

> **보안 메모**: 같은 시리얼이 박힌 두 번째 기기가 있을 가능성이 운영상 우려된다면, 펌웨어 측에서 부팅 시 `/auths` 를 1회만 호출하고 이후엔 저장된 자격증명을 사용하도록 구현하면 됩니다. CSMS 측은 호출이 와도 idempotent 하게 처리합니다.

**500 Internal Server Error — 서버 오류**

```json
{
  "code": 500,
  "status": "Internal Server Error",
  "message": "서버 내부 오류가 발생하였습니다.",
  "timestamp": "2026-05-07 14:30:00",
  "errors": null
}
```

#### c. 응답 코드별 처리 권장 사항

| HTTP 코드 | 의미 | 펌웨어 권장 처리 |
|----------|------|----------------|
| 200 | 성공 (신규 또는 재발급) | `clientId`, `pwd`, `wsUrl`을 비휘발성 저장소에 저장 후 OCPP 접속 진행 |
| 400 | 요청 형식 오류 | 펌웨어 요청 코드 확인 필요 (body 필드 재검토). 즉시 중단, 로그 기록 |
| 401 | 인증 실패 | `x-token` / `x-channel` 펌웨어 설정 확인. Pvpentech CS 담당자에게 토큰 재발급 요청 |
| 404 | 시리얼 미등록 | Pvpentech CS 담당자에게 해당 시리얼번호 사전 등록 요청 |
| 500 | 서버 오류 | 일정 시간 후 재시도 (지수 백오프 권장, 최대 5회) |

> **401과 404의 차이**:
> - 401: `x-token`/`x-channel` 헤더 자체의 인증 문제 — 펌웨어에 저장된 토큰/채널 설정을 확인해야 합니다.
> - 404: 시리얼번호 미등록 문제 — CS 담당자에게 해당 시리얼의 사전 등록을 요청해야 합니다.
>
> **2026-05-08부터 409 응답은 더 이상 발생하지 않습니다** — 동일 시리얼 재호출은 200 OK 로 idempotent 재발급됩니다.

---

## 03. 충전기 펌웨어 권장 흐름

### 1. 초기 설치 시 (Provisioning)

```
[전원 인가]
    │
    ▼
비휘발성 저장소에 clientId / pwd 존재?
    │
    ├─ YES ─► [Phase 2: OCPP 운영 접속으로 이동]
    │
    └─ NO ──►
         │
         ▼
     [POST /auths 호출]
         │
         ├─ 200 OK
         │    │
         │    ▼
         │  clientId, pwd, wsUrl 수신
         │  비휘발성 저장소에 저장
         │    │
         │    └─► [Phase 2: OCPP 운영 접속으로 이동]
         │
         ├─ 409 Conflict
         │    │
         │    └─► 이미 발급된 상태 (저장 데이터 분실 케이스)
         │        오류 로그 기록
         │        CS 담당자에게 reset 요청 대기
         │
         ├─ 401 Unauthorized
         │    │
         │    └─► x-token / x-channel 설정 오류
         │        오류 로그 기록 + 관리자 알림
         │        즉시 중단 (재시도 불필요)
         │
         ├─ 404 Not Found
         │    │
         │    └─► 시리얼 미등록
         │        오류 로그 기록 + 관리자 알림
         │        즉시 중단 (CS 담당자 등록 후 재가동)
         │
         ├─ 400 Bad Request
         │    │
         │    └─► 펌웨어 버그 (요청 형식 문제)
         │        오류 로그 기록
         │        즉시 중단 (코드 수정 필요)
         │
         └─ 5xx Server Error
              │
              └─► 서버 일시 오류
                  지수 백오프 후 재시도 (최대 5회)
                  최대 재시도 초과 시 오류 로그 + 관리자 알림

[Phase 2: OCPP 운영 접속]
    │
    ▼
wsUrl + "/ocpp/" + clientId 로 WebSocket URL 구성
Authorization 헤더: Basic base64(clientId + ":" + pwd)
    │
    ▼
WebSocket 연결 시도
    │
    ├─ 101 Switching Protocols
    │    └─► BootNotification 전송 → 정상 운영 시작
    │
    └─ 401 / 403
         └─► pwd 만료 또는 reset 처리됨
             비휘발성 저장소 초기화
             Phase 1 (Provisioning) 재시작
```

### 2. 응답 코드별 처리 요약

| 코드 | 발생 원인 | 권장 처리 |
|------|----------|---------|
| 200 | 정상 발급 | clientId / pwd / wsUrl 저장 후 OCPP 접속 |
| 400 | 펌웨어 요청 형식 오류 | 로그 기록 후 즉시 중단 (코드 수정 필요) |
| 401 | x-token / x-channel 오류 | 로그 기록 후 즉시 중단 (토큰 설정 확인) |
| 404 | 시리얼 미등록 | 로그 기록 후 즉시 중단 (CS 담당자 연락) |
| (2026-05-08 폐기) 409 | 동일 시리얼 재호출 시 200 OK 로 idempotent 재발급 (One-shot 정책 폐지) |
| 500 | 서버 오류 | 지수 백오프 후 재시도 |

### 3. 재시도 정책

5xx 오류 발생 시 권장 재시도 간격:

| 시도 횟수 | 대기 시간 |
|---------|---------|
| 1회 실패 | 30초 후 재시도 |
| 2회 실패 | 60초 후 재시도 |
| 3회 실패 | 120초 후 재시도 |
| 4회 이후 | 300초 간격 유지 |
| 최대 횟수 | 5회 (제조사 정책에 따라 조정 가능) |

4xx 오류(400/401/404)는 재시도하지 않습니다. 즉시 중단하고 오류 로그를 기록합니다.

### 4. OCPP 운영 접속 절차

`/auths`에서 수신한 값으로 OCPP WebSocket 접속을 구성합니다.

```
수신값 예시:
  data.clientId = "EN1000001"
  data.pwd      = "xK9mP2qR7vL4nJ8sT1wY5oU6eA3bC0dF"
  data.wsUrl    = "wss://pvpentech.kr"

접속 URL 구성:
  URL = data.wsUrl + "/ocpp/" + data.clientId
      = "wss://pvpentech.kr/ocpp/EN1000001"

Authorization 헤더:
  combined  = data.clientId + ":" + data.pwd
            = "EN1000001:xK9mP2qR7vL4nJ8sT1wY5oU6eA3bC0dF"
  encoded   = base64(combined)
  Header    = "Authorization: Basic " + encoded
```

WebSocket 연결 후 즉시 `BootNotification` 메시지를 전송합니다:

```json
[2, "unique-message-id", "BootNotification", {
  "chargePointModel":        "VDA-7kW-AC01",
  "chargePointSerialNumber": "CP-VDA-00123",
  "chargePointVendor":       "VendorA",
  "firmwareVersion":         "1.0.3"
}]
```

서버가 `Accepted`로 응답하면 정상 운영을 시작합니다.

---

## 04. 보안 권고사항 (제조사 펌웨어 측)

### TLS 설정

- TLS 1.2 / TLS 1.3만 지원. TLS 1.1 이하는 허용하지 않음.
- 서버 인증서를 반드시 검증할 것 (인증서 검증 비활성화 금지).
- Let's Encrypt ISRG Root X1 / X2 루트 인증서를 신뢰 목록에 포함할 것.

### 토큰 및 비밀번호 보안

| 저장 대상 | 권장 저장 방식 |
|----------|-------------|
| `x-token` / `x-channel` | Secure Element 또는 암호화된 플래시 영역 |
| `data.pwd` (OCPP 비밀번호) | Secure Element 또는 암호화된 플래시 영역 |
| `data.clientId` | 일반 비휘발성 저장소 가능 (공개 식별자) |
| `data.wsUrl` | 일반 비휘발성 저장소 가능 |

### 시간 동기화

- NTP 동기화를 필수적으로 구현할 것. TLS 인증서 유효기간 검증에 정확한 시각이 필요합니다.
- NTP 서버 예시: `pool.ntp.org`, `time.cloudflare.com`

### 펌웨어 업데이트 시 주의

- `x-token` / `x-channel`이 펌웨어 이미지에 하드코딩된 경우, 토큰 갱신 시 펌웨어 업데이트가 필요합니다.
- 가급적 별도 Secure Storage에 보관하여 펌웨어와 독립적으로 갱신할 수 있도록 설계를 권장합니다.
- `data.pwd`(OCPP 비밀번호)는 프로비저닝 시 1회 발급됩니다. 공장 초기화(factory reset) 시 해당 값을 삭제하고 CS 담당자에게 reset 요청 절차를 안내해야 합니다.

### 기타 권고사항

- `/auths` 호출 전 서버 도메인 DNS 조회 결과를 캐싱하지 않을 것 (TLS 인증 우선).
- `/auths` 호출은 공장 초기화 후 1회만 발생하도록 설계할 것. 주기적으로 반복 호출하지 않을 것.
- 자세한 보안 체크리스트는 별도 문서 `outputs/charger_client_security_checklist.md`를 참조하십시오 (문서 미작성 시 CS 담당자 문의).

---

## 05. 문의 및 지원

| 문의 유형 | 처리 방법 |
|---------|---------|
| 제조사 등록 및 `x-token`/`x-channel` 발급 | Pvpentech CS 담당자에게 요청 |
| 토큰 분실 또는 재발급 | Pvpentech CS 포털에서 재발급 (CS 담당자 처리) |
| 시리얼번호 사전 등록 | Pvpentech CS 포털에서 단건 등록 또는 CSV 일괄 등록 |
| 시리얼번호 대량 등록 | CS 포털 CSV 일괄 업로드 기능 활용 |
| OCPP 접속 문제 | Pvpentech 기술 지원팀에 clientId 및 오류 로그 첨부하여 문의 |

> 연동 담당자 연락처 및 슬랙/이메일 채널은 계약 시 별도로 안내됩니다.

---

## 06. 부록

### A. 환경별 URL 요약표

| 환경 | OCPP (WebSocket) | Provisioning (HTTP) |
|------|-----------------|---------------------|
| 운영 | `wss://pvpentech.kr/ocpp/<clientId>` | `https://pvpentech.kr/auths` |

### B. base64 인코딩 예시

OCPP WebSocket 접속 시 `Authorization: Basic` 헤더에 사용하는 base64 인코딩 방법입니다.

```
충전기 ID (clientId): EN1000140
PASSWORD (pwd):       KQHYDcYAxItjjyKaMlA1HA==

결합 문자열:
  EN1000140:KQHYDcYAxItjjyKaMlA1HA==

base64 인코딩 결과:
  RU4xMDAwMTQwOktRSFlEY1lBeEl0amp5S2FNbEExSEE9PQ==

Authorization 헤더:
  Authorization: Basic RU4xMDAwMTQwOktRSFlEY1lBeEl0amp5S2FNbEExSEE9PQ==
```

언어별 base64 인코딩 방법:

```c
// C 예시 (mbedTLS 사용)
#include "mbedtls/base64.h"

char input[] = "EN1000140:KQHYDcYAxItjjyKaMlA1HA==";
unsigned char output[256];
size_t olen;
mbedtls_base64_encode(output, sizeof(output), &olen,
                      (const unsigned char *)input, strlen(input));
// output: "RU4xMDAwMTQwOktRSFlEY1lBeEl0amp5S2FNbEExSEE9PQ=="
```

```python
# Python 예시
import base64
combined = "EN1000140:KQHYDcYAxItjjyKaMlA1HA=="
encoded  = base64.b64encode(combined.encode()).decode()
# encoded: "RU4xMDAwMTQwOktRSFlEY1lBeEl0amp5S2FNbEExSEE9PQ=="
```

```javascript
// Node.js 예시
const combined = "EN1000140:KQHYDcYAxItjjyKaMlA1HA==";
const encoded  = Buffer.from(combined).toString('base64');
// encoded: "RU4xMDAwMTQwOktRSFlEY1lBeEl0amp5S2FNbEExSEE9PQ=="
```

### C. 자주 묻는 질문 (FAQ)

**Q1. 같은 시리얼번호로 `/auths`를 다시 호출하면 어떻게 됩니까?**

A. (2026-05-08 정책 변경) 동일 시리얼번호로 재호출하면 **200 OK 로 새 `pwd` 가 발급되며, `clientId` 는 이전과 동일하게 유지**됩니다. 펌웨어가 비휘발성 저장소를 분실(공장 초기화)했어도 그대로 다시 부팅하면 자동 복구됩니다. CS 담당자 reset 요청 불필요.

> 구 기기의 `pwd` 는 즉시 무효화되며, OCPP WebSocket 도 자동 강제 종료됩니다. 동일 시리얼이 박힌 두 기기가 동시에 운영되는 일은 자연히 발생하지 않습니다.

---

**Q2. `x-token`을 분실했습니다. 어떻게 해야 합니까?**

A. Pvpentech CS 담당자에게 재발급을 요청하십시오. CS 포털에서 토큰을 재발급하면 기존 토큰은 즉시 무효화됩니다. 재발급된 새 토큰을 펌웨어에 반영(원격 설정 업데이트 또는 펌웨어 업데이트)해야 합니다.

---

**Q3. OCPP 접속용 `pwd`를 분실했습니다.**

A. CS 포털에서 충전기 비밀번호 재발급이 가능합니다. CS 담당자에게 해당 충전기의 `clientId`를 알려주고 reset 처리를 요청하십시오. reset 후 `/auths`를 재호출하거나 새 비밀번호를 직접 전달받는 방식으로 처리됩니다.

---

**Q4. 시리얼번호 대신 모뎀번호로 `origin`을 전송해도 됩니까?**

A. 가능합니다. Pvpentech 시스템에 시리얼번호 사전 등록 시 모뎀번호로 등록했다면, `origin`에 모뎀번호를 그대로 전송하면 됩니다. 단, 사전 등록된 값과 정확히 일치해야 합니다.

---

**Q5. `/auths` 호출 시 `model` 필드는 필수입니까?**

A. 네, v2.0부터 `model` 필드는 필수입니다. 누락 시 400 Bad Request가 반환됩니다.

---

**Q6. OCPP 접속 시 `/EN1000001`과 `/ocpp/EN1000001` 어느 경로를 사용해야 합니까?**

A. 두 경로 모두 지원되지만, `/ocpp/<clientId>` 형식(형식 B)을 권장합니다. `/auths` 응답의 `wsUrl`에 `/ocpp/<clientId>`를 붙여 접속 URL을 구성하십시오.

---

**Q7. 공장 초기화(factory reset) 후 절차는 어떻게 됩니까?**

A.
1. 충전기 비휘발성 저장소에서 `clientId`, `pwd`, `wsUrl` 삭제.
2. CS 담당자에게 해당 시리얼번호의 reset 처리 요청.
3. CS 포털에서 reset 완료 후 `/auths` 재호출.
4. 신규 `clientId`, `pwd`, `wsUrl` 수신 및 저장.
5. OCPP 재접속.

---

**Q8. BootNotification에 어떤 정보를 넣어야 합니까?**

A. 최소 필수 필드는 `chargePointModel`, `chargePointVendor`입니다. 추가로 `chargePointSerialNumber`, `firmwareVersion`을 포함하면 CS 포털에서 장비 이력 관리에 도움이 됩니다.

```json
{
  "chargePointModel":        "VDA-7kW-AC01",
  "chargePointVendor":       "VendorA",
  "chargePointSerialNumber": "CP-VDA-00123",
  "firmwareVersion":         "1.0.3"
}
```

---

*문서 끝. 본 문서의 최신 버전은 Pvpentech CS 담당자에게 문의하십시오.*
