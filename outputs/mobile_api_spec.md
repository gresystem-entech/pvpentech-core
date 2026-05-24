# Pvpentech 모바일 앱 API 규격서

- **작성일**: 2026-04-17
- **버전**: 1.0
- **Base URL**: `https://csms.pvpentech.com`

---

## 공통 규격

### 요청 헤더

| 헤더 | 필수 | 설명 |
|------|------|------|
| `Content-Type` | 본문 있는 요청 | `application/json` |
| `Authorization` | 인증 필요 엔드포인트 | `Bearer {JWT_TOKEN}` |
| `Accept-Language` | 선택 | `ko` / `en` / `vi` (기본값: `ko`) |

### 응답 형식

**성공 응답**: 각 엔드포인트별 상이 (아래 개별 명세 참고)

**에러 응답**: 모든 에러는 아래 단일 형식으로 반환

```json
{
  "detail": "에러 메시지 (Accept-Language에 따라 다국어 반환)"
}
```

### 에러 코드표

| HTTP Status | 상황 |
|-------------|------|
| `400` | 요청 파라미터 누락 또는 형식 오류 |
| `401` | 인증 토큰 없음 / 만료 / 아이디·비밀번호 불일치 |
| `404` | 충전기 없음 / 세션 없음 |
| `409` | 이미 사용 중인 충전기 |
| `422` | 충전기 오프라인 |
| `429` | 요청 횟수 초과 (Rate Limit) |
| `500` | 서버 내부 오류 |

---

## 1. 인증 (Authentication)

### 1-1. 로그인

모바일 앱 사용자 로그인. JWT 토큰 발급 (유효기간 24시간).

```
POST /api/login
```

**Request Body**

```json
{
  "user_id": "john123",
  "password": "password1234"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `user_id` | string | Y | 사용자 아이디 |
| `password` | string | Y | 비밀번호 |

**Response `200 OK`**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**에러 응답 예시**

```json
// 401 - 아이디/비밀번호 불일치
{ "detail": "아이디 또는 비밀번호가 틀렸습니다." }

// 401 - 승인 대기 계정
{ "detail": "승인 대기 중인 계정입니다. 관리자에게 문의하세요." }

// 401 - 비활성화 계정
{ "detail": "비활성화된 계정입니다." }
```

> **Rate Limit**: 동일 IP에서 분당 10회 초과 시 `429` 반환

---

### 1-2. 로그아웃

```
POST /api/logout
```

JWT는 Stateless 방식으로 서버 측 세션이 없습니다.  
클라이언트에서 저장된 토큰을 삭제하면 됩니다.

**Response `200 OK`**

```json
{
  "success": true,
  "message": "로그아웃되었습니다."
}
```

---

### 1-3. 회원가입

```
POST /api/portal/auth/register/customer
```

**Request Body**

```json
{
  "username": "john123",
  "password": "password1234",
  "email": "john@example.com",
  "firstName": "John",
  "lastName": "Doe"
}
```

| 필드 | 타입 | 필수 | 제약 |
|------|------|------|------|
| `username` | string | Y | 3~150자 |
| `password` | string | Y | 최소 6자 |
| `email` | string | N | 이메일 형식 |
| `firstName` | string | N | - |
| `lastName` | string | N | - |

**Response `201 Created`**

```json
{
  "success": true,
  "data": {
    "message": "회원가입이 완료되었습니다."
  }
}
```

> 고객(customer) 계정은 가입 즉시 활성화됩니다.

---

## 2. 충전 (Charging)

> 모든 충전 API는 `Authorization: Bearer {token}` 헤더 필수

### 2-1. 충전 시작

QR 코드 스캔 후 충전을 시작합니다.

```
POST /api/charge/start
```

**Query Parameters**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `qr_code` | string | Y | QR 코드 스캔값 (충전기 ID, 예: `EN300140`) |
| `user_id` | string | Y | 로그인한 사용자 아이디 |
| `goal_type` | string | Y | 충전 목표 유형 (`time` / `kwh` / `amount` / `free`) |
| `goal_value` | number | 조건부 | 목표값. `goal_type`이 `free`가 아닌 경우 필수 |

**goal_type 상세**

| 값 | 설명 | goal_value 단위 |
|----|------|----------------|
| `time` | 시간 제한 충전 | 분 (minutes) |
| `kwh` | 전력량 목표 충전 | kWh |
| `amount` | 금액 목표 충전 | 원 (KRW) |
| `free` | 수동 종료까지 충전 | 불필요 |

**요청 예시**

```
POST /api/charge/start?qr_code=EN300140&user_id=john123&goal_type=kwh&goal_value=20
Authorization: Bearer eyJhbGci...
```

**Response `200 OK`**

```json
{
  "success": true,
  "sessionId": "session_1744853329412"
}
```

> `sessionId`는 이후 충전 상태 조회 및 충전 종료에 사용합니다.

**에러 응답 예시**

```json
// 404 - 존재하지 않는 충전기
{ "detail": "존재하지 않는 충전기입니다." }

// 409 - 이미 사용 중인 충전기
{ "detail": "이미 사용 중인 충전기입니다." }

// 422 - 충전기 오프라인
{ "detail": "충전기가 오프라인 상태입니다." }
```

---

### 2-2. 충전 상태 조회

충전 진행 상태 및 현재 충전량을 조회합니다.

```
GET /api/charge/status
```

**Query Parameters**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `session_id` | string | Y | 충전 시작 시 발급된 sessionId |

**요청 예시**

```
GET /api/charge/status?session_id=session_1744853329412
Authorization: Bearer eyJhbGci...
```

**Response `200 OK`**

```json
{
  "status": "active",
  "kwh": 5.23,
  "reason": null
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `status` | string | `pending` (시작 대기 중) / `active` (충전 중) |
| `kwh` | number | 현재까지 충전된 전력량 (kWh, 소수점 2자리) |
| `reason` | string \| null | 현재는 항상 null |

> 충전이 완료되거나 세션이 종료된 경우 `404`를 반환합니다.

```json
// 404 - 세션 없음 또는 이미 종료됨
{ "detail": "존재하지 않는 충전 세션입니다." }
```

---

### 2-3. 충전 종료

```
POST /api/charge/stop
```

**Query Parameters**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `session_id` | string | Y | 충전 시작 시 발급된 sessionId |

**요청 예시**

```
POST /api/charge/stop?session_id=session_1744853329412
Authorization: Bearer eyJhbGci...
```

**Response `200 OK`**

```json
{
  "success": true,
  "kwh": 12.45,
  "cost": 3112,
  "currency": "KRW",
  "message": "충전이 완료되었습니다."
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `success` | boolean | 종료 성공 여부 |
| `kwh` | number | 총 충전량 (kWh, 소수점 2자리) |
| `cost` | number | 요금 (원, 정수) |
| `currency` | string | 통화 (`KRW` 고정) |
| `message` | string | 완료 메시지 (Accept-Language에 따라 다국어) |

> 요금은 충전소별 단가(원/kWh)를 기준으로 계산하며, 충전소에 단가가 없을 경우 시스템 기본값을 사용합니다.

**에러 응답 예시**

```json
// 404 - 이미 종료된 세션
{ "detail": "이미 종료되었거나 존재하지 않는 세션입니다." }
```

---

## 3. 일반 충전 플로우

```
[앱 실행]
  1. POST /api/login  →  JWT 토큰 저장

[QR 코드 스캔]
  2. POST /api/charge/start?qr_code={충전기ID}&user_id={유저ID}&goal_type=free
     →  sessionId 수신

[충전 중 (폴링 권장 주기: 5~10초)]
  3. GET /api/charge/status?session_id={sessionId}
     →  { status, kwh } 확인

[충전 종료]
  4. POST /api/charge/stop?session_id={sessionId}
     →  { kwh, cost } 수신, 결과 화면 표시
```

---

## 4. 인증 토큰 관리

- 토큰 유효기간: **24시간**
- 형식: `Authorization: Bearer {token}`
- 만료 시: `401` 응답 → 재로그인 필요
- 갱신 API 없음 (만료 시 로그인 재시도)

---

## 5. 다국어 지원

`Accept-Language` 헤더로 응답 메시지 언어를 제어합니다.

| 헤더 값 | 언어 |
|---------|------|
| `ko` | 한국어 (기본) |
| `en` | 영어 |
| `vi` | 베트남어 |

**요청 예시**

```
POST /api/login
Accept-Language: en
```

**응답 예시 (`en`)**

```json
{ "detail": "Invalid username or password." }
```

---

## 6. 서버 환경

| 환경 | Base URL |
|------|----------|
| 운영 | `https://csms.pvpentech.com` |

---

## 7. 변경 이력

| 날짜 | 버전 | 내용 |
|------|------|------|
| 2026-04-17 | 1.0 | 최초 작성 |
