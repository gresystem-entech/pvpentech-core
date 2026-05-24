# 모바일 기기를 이용한 사용자 시나리오
## 필요한 API
로그인	POST /api/login	
충전시작	POST /api/charge/start	
충전상태조회	GET   /api/charge/status	
충전종료	POST /api/charge/stop	
결제시작	POST /api/payment/create	
결제완료webhook	POST /api/payment/ipn	
결제상태조회	POST /api/payment/status/{order_ref}	
## API 흐름
로그인 -> 충전시작 -> 결제시작 -> 결제상태조회 -> 결제완료 -> 충전상태조회 -> 충전완료
### 로그인
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
  "user_id": "jeongsooh",
  "password": "<YOUR_SSH_PASSWORD>"
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
	
### 충전시작

#### `POST /api/charge/start`

QR 코드 스캔 후 사용자가 충전 목표를 선택하면 호출됩니다.
충전기 ID, 사용자 ID, 충전 목표를 함께 전달하여 세션을 생성합니다.

**Request Header**
```
Authorization: Bearer {token}
```

**Query Parameters**
```
POST /api/charge/start?qr_code=ENT300136&user_id=jeongsooh&goal_type=kwh&goal_value=10.5
```

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `qr_code` | string | ✅ | QR 코드에서 읽은 충전기 ID (예: `ENT300136`) |
| `user_id` | string | ✅ | 로그인한 사용자 ID |
| `goal_type` | string | ✅ | 충전 목표 유형 (`time` / `kwh` / `amount` / `free`) |
| `goal_value` | double | 조건부 | 목표값. `free`일 때는 생략, 나머지는 필수 |

**`goal_type` 상세**

| 값 | `goal_value` 의미 | 예시 |
|----|-----------------|------|
| `time` | 충전 시간 (분 단위) | `30.0` → 30분 충전 |
| `kwh` | 충전량 (kWh) | `10.5` → 10.5kWh 충전 |
| `amount` | 충전 금액 (원) | `5000.0` → 5,000원어치 충전 |
| `free` | 제한 없음 | `goal_value` 파라미터 없음 |

**Request Body**: 없음

**Response (200 OK)**
```json
{
  "success": true,
  "amount": "5000.0",
  "sessionId": "session_1741856400"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `success` | boolean | 세션 생성 성공 여부 |
| `amount` | string | 충전 목표를 환산한 사용자가 지불할 금액 |
| `sessionId` | string | 이후 충전 상태 조회 및 종료에 사용할 세션 ID |

> **sessionId 생성 규칙**: 서버에서 자유롭게 정의 가능합니다. 앱은 이 값을 불투명한 문자열로만 취급합니다.

**Error Response**

| 상태코드 | 조건 | 앱 처리 |
|----------|------|---------|
| `401 Unauthorized` | 토큰 인증 실패 | Toast: "인증에 실패했습니다." |
| `404 Not Found` | 존재하지 않는 충전기 ID | Toast: "존재하지 않는 세션입니다." |
| `기타 4xx/5xx` | 서버 오류 | Toast: "서버 오류가 발생했습니다. ({코드})" |

---

### 충전상태조회
#### `GET /api/charge/status`

현재 충전 세션의 상태와 누적 충전량(kWh)을 반환합니다.

> **앱 동작**: 충전 화면 진입 후 **60초마다 자동 폴링**합니다.

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
| `active` | 충전 중 | `{"status":"active","kwh":1.234}` | 충전 화면 정상 표시, kWh 업데이트 |
| `failed` | 차량 미연결로 세션 취소 | `{"status":"failed","reason":"차량이 연결되지 않았습니다.","kwh":0.0}` | 팝업 "충전이 시작되지 않았습니다" → 화면 종료 |

> **참고**: 앱은 `kwh` 값으로 목표(kWh/금액) 달성 여부를 판단합니다.
> 금액 계산은 앱 내부에서 `kwh × 250(원/kWh)`으로 처리합니다.

**Error Response**

| 상태코드 | 조건 | 앱 처리 |
|----------|------|---------|
| `401 Unauthorized` | 토큰 인증 실패 | Toast: "인증에 실패했습니다." |
| `404 Not Found` | 세션 종료(충전 완료) — 서버가 세션을 제거한 상태 | 충전 완료 화면으로 자동 전환 |

> **404 처리**: 서버가 충전을 정상 완료하고 세션을 제거한 신호로 해석합니다.
> 앱은 `/api/charge/stop` 호출 후 완료 화면으로 이동합니다.

---
### 충전종료
#### `POST /api/charge/stop`

충전 세션을 종료하고 최종 정산 정보를 반환합니다.

> **앱 동작**: 다음 중 하나의 조건에서 자동 호출됩니다.
> - 사용자가 "충전 정지" 버튼을 누른 경우
> - 설정한 목표(시간/kWh/금액)에 도달한 경우
> - 상태 조회에서 서버가 404를 반환한 경우 (서버 측 세션 종료)

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
  "message": "충전이 완료되었습니다. 이용해 주셔서 감사합니다."
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

### 결제요청
요청: 해당 충전기에서 충전하는데 지불할 비용에 대한 결제 요청 (충전기 아이디와 결제금액)
응답: 결제정보 식별자(order_reference), payment_url (Deeplink일 수도 있음 - 이것에 대한 것도 필요), is_mock (true / false), 사용자 device 정보
```
{
    order_reference,
    payment_url,
    is_mock,
    "device : {
        os: {
            name: ""Windows"",
            version: ""Windows 10"",
        },
        browser: {
            name=""Chrome"",
            version: ""90.0.142""
        },
        location: {
            ""long"": ""33.12"",
            ""lat"": ""13.12""
        }
    }"
}
```
### 결제완료webhook
- 결제처리 결과 알림(from MB Bank ==> CSMS) webhook
- 요청
pg_amount	*	10000.00
pg_currency	*	VND
pg_merchant_id	*	가맹점 id (MB Bank가 우리회사에 부여한 id)
pg_order_info	*	결제내용. 은행 이체 메모란에 자동입력되는 내용임
pg_order_reference	*	가맹점 거래번호(우리 시스템에서 부여하는 거래번호)
pg_payment_method	*	QR
pg_card_number		카드번호 (고객이 카드로 결제한 경우)
pg_card_holder_name		카드소지자명(고객이 카드로 결제한 경우)
pg_payment_channel	*	QR | Online
pg_transaction_number	*	MB Bank내에서 부여한 거래번호
pg_issuer_txn_reference	*	발급사(은행, 신용카드)측 거래번호
pg_issuer_code	*	발급사(은행, 신용카드) 기관식별코드
error_code	*	MB Bank내부의 결제처리 결과코드
pg_issuer_response_code	*	발급사(은행, 신용카드) 의 응답코드
pg_paytime	*	"거래시간. 예, 29062020010000<ddMMyyyyHHmmss>"
session_id	*	"방금 생성된 결제 거래를 식별하기 위한 결제 세션 ID 결제생성시 응답으로 받았던 정보"
mac_type	*	서명 암호화 방식(기본값 : SHA256)
mac	*	
- 응답 none
### 결제상태조회
- 요청: GET /api/payment/status/{order_ref}
- 응답
status	*	"PENDING" | "PAID" | "FAILED" | "REFUNDED" 
order_reference	*	

# 결제요청에 대한 CSMS와 MB Bank 간 API
## 필요한 API
결제거래 생성요청	POST /private/ms/pg-paygate/paygate/create-order			
거래정보 조회	POST /private/ms/pgpaygate/paygate/detail			
환불요청	POST /private/ms/pgpaygate/paygate/refund/single			
### 결제거래 생성요청
- 요청
amount	*	결제금액
currency	*	VND
access_code	*	MB Pay가 가맹점(우리회사)에 제공하는 연동코드(접속코드)
mac_type	*	서명 암호화 방식(기본값 : MD5)
mac	*	
mechant_id	*	
order_info	*	사용자의 거래내역 적요에 출력되는 내용
order_reference	*	"- payment_method = ATMCARD 인 경우: 채널(Channel) + TT + 자동 생성된 8자리 문자 형식
- payment_method = QR 인 경우: 채널(Channel) + QR + 자동 생성된 12~28자리 문자 형식"
device		"os={name=Windows,
version=windows-10}
&browser={name=Chrome, version
=90.0.4430.85}&location={long=0,
lat=0}"
return_url	*	거래 결과 알림을 수신할 url(client단에서 처리할 내용)
cancel_url	*	결제 취소 알림을 수신할 url(client단에서 처리할 내용)
ipn_url	*	결제 결과 수신 url(우리 서버가 결제 결과를 수신할 수 있는 url)
pay_type	*	pay | pay_save | pay_token
merchant_user_reference		가맹점(우리회사)측 고객 결제 계좌 식별자(ID) 예, USER10000001
token_issuer_code		pay_type이 'pay_token'인 경우, token 발행기관 식별코드
token		pay_type이 'pay_token'인 경우, 주문결제에 사용되는 tokenization code
ip_address	*	결제고객의 IP주소
payment_method		ATMCARD | QR | EWALLET | ...

- 응답
session_id		요청한 결제에 대한 식별값
payment_url		결제 gateway의 주문결제 URL(웹뷰 형식의 결제page url)
qr_url		주문 QR이미지 링크(문자열)
expire_time		결제만료시간, 05-04-2022 09:22:48 (DD-MM-YYYY hh:mm:ss)
error_code	*	00 (00: 성공)
message	*	상세 거래 결과
mac	*	MB 측 응답의 무결성을 검증하기 위한 인증 서명
mac_type	*	서명(mac) 암호화 방식(기본값 : MD5)
merchant_id	*	MB에서 발급한 가맹점(우리회사) 식별코드
amount	*	12000.00
currency	*	VND

### 거래정보조회
- 요청
mac_type	*	MD5
mac	*	
merchant_id	*	
order_reference	*	
pg_transaction_reference		
pay_date	*	21122021 <ddMMyyyy>

- 응답
mac_type	*	
mac	*	
error_code	*	
message	*	
amount		
currency		
merchant_id		
order_info		
order_reference		
transaction_number		
issuer		
resp_code		
pg_payment_method		
trans_time		"22082022173646
<ddMMyyyyHHmmss>"

### 환불요청
- 요청
txn_amount	*	100000.00
desc	*	
access_code	*	MB Pay에서 가맹점(우리회사)에 발급하는 연동코드
mac_type	*	서명 암호화 방식(기본값: MD5)
mac	*	
merchant_id	*	
transaction_reference_id	*	게이트웨이측의 원거래 번호
trans_date	*	ddMMyyyy  
- 응답
refund_amount	*	10000.00
refund_type	*	환불유형(부분 환불 | 전체 환불, partial | full)
refund_id	*	MB측의 환불거래번호
refund_reference_id	*	MB측의 원거래번호
mac_type	*	
mac	*	
error_code	*	
message	*	