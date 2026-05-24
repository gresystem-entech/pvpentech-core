# Pvpentech API Specification

- **버전**: v1.1
- **작성일**: 2026-03-13
- **최종 수정**: 2026-03-14
- **대상**: 서버 개발자
- **앱**: Pvpentech Android (com.example.evcharger)

---

## 개요

Pvpentech 앱은 전기차 충전기에 부착된 QR 코드를 스캔하여 충전 세션을 시작·관리하는 앱입니다.
앱과 서버는 REST API(JSON)로 통신하며, 로그인 이후 모든 요청에는 Bearer 토큰 인증이 필요합니다.

### Base URL
```
http://{서버 IP 또는 도메인}:{포트}
```
> 현재 앱 설정: `http://192.168.0.30:8005` (`Constants.BASE_URL`)
> 신규 서버 연동 시 `app/src/main/java/com/example/evcharger/util/Constants.kt`의 `BASE_URL` 값을 변경하면 됩니다.

### Content-Type
- 요청(Request): `application/json`
- 응답(Response): `application/json`

### 인증 방식
로그인 성공 후 발급받은 토큰을 모든 API 요청 헤더에 포함합니다.
```
Authorization: Bearer {token}
```

---

## 전체 흐름

```
[앱 실행]
    │
    ▼
POST /api/login  ──► 토큰 발급
    │
    ▼
[QR 코드 스캔]  (충전기 ID 추출)
    │
    ▼
POST /api/charge/start?qr_code={충전기ID}  ──► sessionId 발급
    │
    ▼
[충전 목표 설정: 시간 / kWh / 금액 / Free]
    │
    ▼
GET /api/charge/status?session_id={sessionId}  ──► 세션 상태 및 kWh 반환
    │  (앱이 3초마다 반복 폴링)
    ▼
POST /api/charge/stop?session_id={sessionId}  ──► 최종 정산 결과 반환
    │
    ▼
[충전 완료 화면 표시]
```

---

## API 상세

---

### 1. 로그인

#### `POST /api/login`

사용자 인증 후 세션 토큰을 발급합니다.

**Request Header**
```
Content-Type: application/json
```
> 로그인 API는 Authorization 헤더 불필요

**Request Body**
```json
{
  "user_id": "test",
  "password": "1234"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `user_id` | string | ✅ | 사용자 ID |
| `password` | string | ✅ | 비밀번호 |

**Response (200 OK)**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `success` | boolean | 로그인 성공 여부 |
| `token` | string | 이후 API 호출에 사용할 인증 토큰 |

**Error Response**

| 상태코드 | 조건 | 앱 처리 |
|----------|------|---------|
| `401 Unauthorized` | 아이디 또는 비밀번호 불일치 | Toast: "인증에 실패했습니다." |

```json
// 401 응답 예시
{
  "detail": "아이디 또는 비밀번호가 틀렸습니다."
}
```

---

### 2. 충전 시작

#### `POST /api/charge/start`

QR 코드로 스캔한 충전기 ID를 서버에 전달하여 충전 세션을 생성합니다.

**Request Header**
```
Authorization: Bearer {token}
```

**Query Parameter**
```
POST /api/charge/start?qr_code=ENT300136
```

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `qr_code` | string | ✅ | QR 코드에서 읽은 충전기 ID (예: `ENT300136`) |

**Request Body**: 없음

**Response (200 OK)**
```json
{
  "success": true,
  "sessionId": "session_1741856400"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `success` | boolean | 세션 생성 성공 여부 |
| `sessionId` | string | 이후 충전 상태 조회 및 종료에 사용할 세션 ID |

> **sessionId 생성 규칙**: 서버에서 자유롭게 정의 가능합니다. 앱은 이 값을 불투명한 문자열로만 취급합니다.

**Error Response**

| 상태코드 | 조건 | 앱 처리 |
|----------|------|---------|
| `401 Unauthorized` | 토큰 인증 실패 | Toast: "인증에 실패했습니다." |
| `404 Not Found` | 존재하지 않는 충전기 ID | Toast: "존재하지 않는 세션입니다." |
| `기타 4xx/5xx` | 서버 오류 | Toast: "서버 오류가 발생했습니다. ({코드})" |

---

### 3. 충전 상태 조회

#### `GET /api/charge/status`

현재 충전 세션의 상태와 누적 충전량(kWh)을 반환합니다.

> **앱 동작**: 충전 화면 진입 후 **3초마다 자동 폴링**합니다.

**Request Header**
```
Authorization: Bearer {token}
```

**Query Parameter**
```
GET /api/charge/status?session_id=session_1741856400
```

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `session_id` | string | ✅ | 충전 시작 시 발급받은 세션 ID |

**Request Body**: 없음

**Response (200 OK)**
```json
{
  "status": "active",
  "kwh": 3.45,
  "reason": null
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `status` | string | 세션 상태: `pending` / `active` / `failed` |
| `kwh` | double | 세션 시작 이후 누적 충전량 (kWh). `pending`/`failed` 시 `0.0` |
| `reason` | string? | `failed` 상태일 때 실패 사유. 그 외 `null` |

**status 값 상세**

| status | 의미 | 응답 예시 | 앱 동작 |
|--------|------|-----------|---------|
| `pending` | RemoteStart 전송됨, 차량 연결 대기 중 | `{"status":"pending","kwh":0.0}` | "차량 연결 대기 중..." 표시, 폴링 유지 |
| `active` | 충전 중 | `{"status":"active","kwh":1.234}` | 충전 화면 정상 표시 |
| `failed` | 차량 미연결로 세션 취소 | `{"status":"failed","reason":"차량이 연결되지 않았습니다.","kwh":0.0}` | 팝업 "충전이 시작되지 않았습니다" → 화면 종료 |

> **참고**: 앱은 `kwh` 값으로 목표(kWh/금액) 달성 여부를 판단합니다.
> 금액 계산은 앱 내부에서 `kwh × 250(원/kWh)`으로 처리합니다.

**Error Response**

| 상태코드 | 조건 | 앱 처리 |
|----------|------|---------|
| `401 Unauthorized` | 토큰 인증 실패 | Toast: "인증에 실패했습니다." |
| `404 Not Found` | 세션 종료(충전 완료) — 서버가 세션을 제거한 상태 | 충전 완료 화면으로 자동 전환 |

> **404 동작 변경**: 이전 버전은 404를 에러로 처리했으나, v1.1부터 서버가 충전을 정상 완료하고 세션을 제거한 신호로 해석합니다. 앱은 `/api/charge/stop` 호출 후 완료 화면으로 이동합니다.

---

### 4. 충전 종료

#### `POST /api/charge/stop`

충전 세션을 종료하고 최종 정산 정보를 반환합니다.

> **앱 동작**: 사용자가 "Stop Charging" 버튼을 누르거나, 설정한 목표(시간/kWh/금액)에 도달하면 자동으로 호출됩니다.

**Request Header**
```
Authorization: Bearer {token}
```

**Query Parameter**
```
POST /api/charge/stop?session_id=session_1741856400
```

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `session_id` | string | ✅ | 종료할 세션 ID |

**Request Body**: 없음

**Response (200 OK)**
```json
{
  "success": true,
  "kwh": 12.75,
  "cost": 3187,
  "currency": "KRW",
  "message": "Charging complete."
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `success` | boolean | 종료 처리 성공 여부 |
| `kwh` | double | 최종 누적 충전량 (kWh) |
| `cost` | int | 최종 충전 요금 (원 단위 정수) |
| `currency` | string | 통화 코드 (`"KRW"` 고정 권장) |
| `message` | string | 앱 완료 화면에 표시할 안내 메시지 |

> **참고**: 응답 후 서버는 해당 세션을 메모리/DB에서 제거해도 됩니다. 이후 동일 session_id로 조회하면 404를 반환합니다.

**Error Response**

| 상태코드 | 조건 | 앱 처리 |
|----------|------|---------|
| `401 Unauthorized` | 토큰 인증 실패 | Toast: "인증에 실패했습니다." |
| `404 Not Found` | 이미 종료되었거나 존재하지 않는 세션 | Toast: "존재하지 않는 세션입니다." |

---

## 공통 에러 규격

앱의 에러 핸들링은 HTTP 상태 코드 기반입니다. 에러 응답 바디는 아래 형식을 권장합니다.

```json
{
  "detail": "에러 설명 메시지"
}
```

| 상태코드 | 의미 | 앱 반응 |
|----------|------|---------|
| `200` | 성공 | 정상 처리 |
| `401` | 인증 실패 (토큰 없음/만료/불일치) | "인증에 실패했습니다." Toast |
| `404` | 리소스 없음 (세션/충전기 ID 미존재) | "존재하지 않는 세션입니다." Toast |
| `4xx` | 기타 클라이언트 오류 | "서버 오류가 발생했습니다. ({코드})" Toast |
| `5xx` | 서버 내부 오류 | "서버 오류가 발생했습니다. ({코드})" Toast |
| 네트워크 오류 | 서버 미응답, 타임아웃 등 | "네트워크 연결을 확인해 주세요." Toast |

---

## 서버 구현 시 고려사항

### 1. 토큰 관리
- 앱은 토큰을 `EncryptedSharedPreferences`(AES-256-GCM)에 저장하며, 앱 재시작 시 자동 로그인에 사용합니다.
- 토큰 만료 처리: 현재 앱은 401 응답 시 에러 Toast만 표시합니다. 만료 토큰 감지 후 로그인 화면으로 자동 이동하는 기능은 추후 구현 예정입니다.
- JWT 사용을 권장합니다.

### 2. 충전 세션
- 세션은 `qr_code`(충전기 ID) 기준으로 생성됩니다.
- 동일 충전기에 대해 동시 세션 중복 생성을 방지하는 로직을 서버에서 처리해야 합니다.
- 세션 상태(`시작시간`, `현재 kWh`, `충전기 ID`, `사용자 ID`)를 DB에 저장하는 것을 권장합니다.

### 3. 충전량(kWh) 계산
- `/api/charge/status` 응답의 `kwh`는 세션 시작 이후 누적 충전량입니다.
- 실제 충전기 장비와의 통신(OCPP 프로토콜 등)으로 실시간 값을 반영해야 합니다.
- 테스트 환경에서는 시간 경과에 비례한 시뮬레이션 값으로 대체 가능합니다.

### 4. 요금 계산
- 현재 앱은 목표 설정(금액 목표 판단 시) 내부적으로 `kWh × 250원`을 사용합니다.
- `/api/charge/stop` 응답의 `cost`는 서버에서 최종 계산하여 반환해야 합니다.
- 요금 정책(단가, 시간대별 차등 등)은 서버에서 관리합니다.

### 5. CORS / 네트워크 보안
- 앱의 `network_security_config.xml`에 `cleartextTrafficPermitted="true"`가 설정되어 있어 HTTP 통신이 허용됩니다.
- 프로덕션 환경에서는 HTTPS 적용을 권장합니다.

---

## 데이터 모델 요약

```
LoginRequest        { user_id: String, password: String }
LoginResponse       { success: Boolean, token: String? }

ChargeStartResponse  { success: Boolean, sessionId: String }
ChargeStatusResponse { status: String, kwh: Double, reason: String? }
ChargeStopResponse   { success: Boolean, kwh: Double, cost: Int, currency: String, message: String }
```

> `ChargeStartResponse.sessionId`는 앱 내부에서 `sessionId` (camelCase)로 역직렬화됩니다.
> 서버 응답 JSON 키를 `sessionId`로 맞추거나, 앱 모델에 `@SerializedName("session_id")` 어노테이션을 추가해야 합니다.

---

## 구현 예시 (Python / FastAPI)

아래는 현재 앱과 호환되는 서버 구현 참고용 최소 예시입니다.

```python
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import time

app = FastAPI()
mock_sessions: dict = {}

class LoginRequest(BaseModel):
    user_id: str
    password: str

# 1. 로그인
@app.post("/api/login")
async def login(req: LoginRequest):
    if req.user_id == "test" and req.password == "1234":
        return {"success": True, "token": "your_jwt_token_here"}
    raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다.")

# 2. 충전 시작
@app.post("/api/charge/start")
def start_charge(qr_code: str, authorization: str = Header(None)):
    verify_token(authorization)
    session_id = f"session_{int(time.time())}"
    mock_sessions[session_id] = {"start_time": time.time(), "kwh": 0.0, "charger_id": qr_code}
    return {"success": True, "sessionId": session_id}

# 3. 충전 상태 조회
@app.get("/api/charge/status")
def get_status(session_id: str, authorization: str = Header(None)):
    verify_token(authorization)
    if session_id not in mock_sessions:
        raise HTTPException(status_code=404, detail="존재하지 않는 충전 세션입니다.")
    elapsed = time.time() - mock_sessions[session_id]["start_time"]
    kwh = round(elapsed * 0.2, 2)  # 예시: 초당 0.2kWh
    mock_sessions[session_id]["kwh"] = kwh
    # status: "pending" → "active" (예: 10초 이후 active로 전환 시뮬레이션)
    status = "active" if elapsed > 10 else "pending"
    return {"status": status, "kwh": kwh, "reason": None}

# 4. 충전 종료
@app.post("/api/charge/stop")
def stop_charge(session_id: str, authorization: str = Header(None)):
    verify_token(authorization)
    if session_id not in mock_sessions:
        raise HTTPException(status_code=404, detail="이미 종료되었거나 없는 세션입니다.")
    final_kwh = mock_sessions.pop(session_id)["kwh"]
    return {
        "success": True,
        "kwh": final_kwh,
        "cost": int(final_kwh * 250),
        "currency": "KRW",
        "message": "Charging complete."
    }

def verify_token(authorization: str):
    if authorization != "Bearer your_jwt_token_here":
        raise HTTPException(status_code=401, detail="토큰 인증 실패")
```

---

## 변경 이력

| 날짜 | 버전 | 내용 |
|------|------|------|
| 2026-03-13 | v1.0 | 최초 작성 |
| 2026-03-14 | v1.1 | `GET /api/charge/status` 응답에 `status`, `reason` 필드 추가; 폴링 주기 60초 → 3초; 404를 충전 완료 신호로 재정의 |
