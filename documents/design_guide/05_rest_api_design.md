# 05. REST API 설계 패턴 가이드

- **버전**: v1.2
- **작성일**: 2026-03-31
- **업데이트**: 2026-04-15 (v1.2 — payment_settlement.md 반영: 결제/환불 API, 수동정산 API, ChargerConfig API, 프로비저닝 키워드검색/CSV업로드, 장애로그 키워드 필터, 정산 일괄배치 추가)
- **대상**: Node.js 백엔드 개발자
- **참조**: `design_ref/05_Pvpentech_API_Specification.md`, `design_ref/06_portal_implementation_plan.md`, `design_ref/usage_scenario.txt`

---

## 1. 개요 (Overview)

Pvpentech REST API의 설계 원칙, 엔드포인트 목록, 요청/응답 구조를 정의합니다.
세 가지 API 그룹으로 구성됩니다.

| 그룹 | Base Path | 주요 소비자 |
|------|-----------|-------------|
| 프로비저닝 API | `/provision` | 충전기 (최초 설치 시) |
| 모바일 충전 API | `/api/` | Android 앱 |
| 포털 API | `/api/portal/` | 웹 포털 (고객센터/파트너/고객) |
| OCPP 관리 API | `/api/admin/` | 관리자 (충전기 원격 명령) |

---

## 2. 공통 규칙

### 2.0 공통 요청 헤더

모든 API 요청에서 사용 가능한 공통 헤더입니다.

| 헤더 | 필수 여부 | 예시 | 설명 |
|------|-----------|------|------|
| `Authorization` | 인증 필요 엔드포인트에서 필수 | `Bearer eyJ...` | JWT 액세스 토큰 |
| `Content-Type` | POST/PUT 요청 시 필수 | `application/json` | 요청 바디 형식 |
| `Accept-Language` | 선택 | `vi`, `en`, `ko` | 응답 메시지 언어 지정 (기본값: `ko`) |

**`Accept-Language` 헤더 동작 방식**

서버는 `Accept-Language` 헤더를 파싱하여 에러 메시지, 알림 메시지 등 사용자 노출 텍스트를 해당 언어로 반환합니다. 지원 언어는 `ko`, `en`, `vi`이며, 지원하지 않는 언어 코드가 전달되면 기본값 `ko`로 폴백합니다.

```http
# 요청 예시 - 베트남어로 응답 요청
GET /api/charge/status?session_id=session_1741856400
Authorization: Bearer eyJ...
Accept-Language: vi
```

```json
// 에러 발생 시 베트남어 메시지로 응답
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Phiên sạc không tồn tại."
  }
}
```

> **모바일 앱 API 하위 호환 주의**: 기존 앱은 `{ detail: "..." }` 형식의 에러 응답을 기대합니다. `/api/` 경로의 모바일 앱 API는 `detail` 필드에도 다국어 메시지를 반환합니다.

### 2.1 응답 형식

모든 API 응답은 다음 형식을 따릅니다.

```typescript
// 성공 응답
interface ApiResponse<T> {
  success: true;
  data: T;
}

// 에러 응답
interface ApiErrorResponse {
  success: false;
  error: {
    code: string;     // 내부 에러 코드 (언어 무관, 고정값)
    message: string;  // 사람이 읽을 수 있는 메시지 (Accept-Language 기반 다국어)
  };
}

// 다국어 에러 응답 예시 (Accept-Language: en)
// {
//   "success": false,
//   "error": {
//     "code": "NOT_FOUND",         ← 언어에 관계없이 항상 영문 코드
//     "message": "The charging station does not exist."  ← 언어에 따라 변경
//   }
// }
```

> **하위 호환성 주의**: 앱은 `{ success, token }`, `{ success, sessionId }` 등 현재 API 스펙의 응답 형식을 직접 사용합니다.
> 모바일 충전 API(`/api/login`, `/api/charge/*`)는 기존 스펙 응답 형식을 그대로 유지해야 합니다.

### 2.2 HTTP 상태 코드

| 코드 | 의미 |
|------|------|
| 200 | 성공 |
| 201 | 리소스 생성 성공 |
| 400 | 잘못된 요청 (유효성 검사 실패) |
| 401 | 인증 실패 (토큰 없음/만료/불일치) |
| 403 | 권한 없음 (역할 미달) |
| 404 | 리소스 없음 |
| 409 | 충돌 (중복 세션 등) |
| 422 | 처리 불가 (비즈니스 로직 위반) |
| 500 | 서버 내부 오류 |

### 2.3 페이지네이션

목록 조회 API는 쿼리 파라미터로 페이지네이션을 지원합니다.

```
GET /api/portal/cs/sessions?page=1&limit=20&startDate=2026-03-01&endDate=2026-03-31
```

```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

---

## 2-1. 프로비저닝 API (충전기 전용) [신규 — v1.1]

인증 불필요 엔드포인트. Rate Limiting 강화 적용 (IP당 분당 5회).

```
POST /provision
```

**Request Body**
```json
{ "serial_number": "SN-VENDOR-2026-001" }
```

**Response (200)** — 프로비저닝 성공
```json
{
  "station_id": "EN1000001",
  "csms_server": "wss://pvpentech.example.com",
  "uri": "/ws/",
  "port": 443,
  "password": "randomGeneratedPassword123"
}
```

**Response (403)** — 미등록 시리얼번호
```json
{ "success": false, "error": { "code": "PROVISION_REJECTED", "message": "등록되지 않은 충전기입니다." } }
```

**Response (409)** — 이미 프로비저닝 완료
```json
{ "success": false, "error": { "code": "ALREADY_PROVISIONED", "message": "이미 프로비저닝이 완료된 충전기입니다." } }
```

상세 설계는 `12_charger_provisioning.md`를 참조하세요.

---

## 3. 모바일 충전 API (앱 전용)

앱의 기존 스펙(`design_ref/05_Pvpentech_API_Specification.md`)을 그대로 유지합니다.

### 3.1 로그인

```
POST /api/login
```

**Request Body**
```json
{ "user_id": "string", "password": "string" }
```

**Response (200)**
```json
{ "success": true, "token": "eyJ..." }
```

**Error (401)**
```json
{ "detail": "아이디 또는 비밀번호가 틀렸습니다." }
```

### 3.2 충전 시작

```
POST /api/charge/start?qr_code={stationId}&user_id={userId}&goal_type={type}&goal_value={value}
```

내부 처리 흐름:
1. 충전기 존재 확인 (DB 조회)
2. 동일 충전기 활성 세션 중복 체크
3. `Transaction` 레코드 생성 (status: `Pending`)
4. OCPP `RemoteStartTransaction` 명령 전송 (비동기)
5. sessionId 즉시 반환 (앱은 폴링으로 상태 확인)

**Response (200)**
```json
{ "success": true, "sessionId": "session_1741856400" }
```

**Error (404)** — 존재하지 않는 충전기
```json
{ "detail": "존재하지 않는 충전기입니다." }
```

**Error (409)** — 이미 충전 중인 충전기
```json
{ "detail": "이미 사용 중인 충전기입니다." }
```

### 3.3 충전 상태 조회

```
GET /api/charge/status?session_id={sessionId}
```

**Response (200)**
```json
{
  "status": "active",
  "kwh": 3.45,
  "reason": null
}
```

**Error (404)** — 세션이 종료되어 제거된 상태 (앱이 완료 화면으로 전환)

### 3.4 충전 종료

```
POST /api/charge/stop?session_id={sessionId}
```

내부 처리 흐름:
1. 세션 존재 확인
2. OCPP `RemoteStopTransaction` 명령 전송
3. `Transaction` 레코드 업데이트 (status: `Stopped`, `timeEnd`, `meterEnd`, `costKrw`)
4. 최종 정산 결과 반환

**Response (200)**
```json
{
  "success": true,
  "kwh": 12.75,
  "cost": 3187,
  "currency": "KRW",
  "message": "충전이 완료되었습니다. 이용해 주셔서 감사합니다."
}
```

---

## 4. 포털 API

포털 API는 역할 기반 접근 제어를 적용합니다.

### 4.1 인증

```
POST /api/portal/auth/login
POST /api/portal/auth/logout
POST /api/portal/auth/register/customer
POST /api/portal/auth/register/partner
POST /api/portal/auth/register/cs
```

### 4.2 고객센터 (CS) API

**대시보드**
```
GET /api/portal/cs/dashboard              # 요약 통계
GET /api/portal/cs/dashboard/stats?period=daily|weekly|monthly  # 서비스 현황
GET /api/portal/cs/dashboard/stats/detail?period=daily&date=2026-03-30  # 상세내역
```

**사용자 관리**
```
GET    /api/portal/cs/users               # 목록 (role, status, keyword 필터)
POST   /api/portal/cs/users               # 사용자 생성
GET    /api/portal/cs/users/:id           # 상세
PUT    /api/portal/cs/users/:id           # 수정
DELETE /api/portal/cs/users/:id           # 소프트 삭제
PATCH  /api/portal/cs/users/:id/toggle-active  # 활성/비활성 토글
GET    /api/portal/cs/users/:id/cards     # 결제 카드 목록
POST   /api/portal/cs/users/:id/cards     # 결제 카드 등록
DELETE /api/portal/cs/users/:id/cards/:cardId  # 결제 카드 삭제
```

**파트너 관리**
```
GET    /api/portal/cs/partners                         # 목록 (승인대기 포함)
POST   /api/portal/cs/partners                         # 파트너 생성
GET    /api/portal/cs/partners/:id                     # 상세 (소속 충전소/충전기 포함)
PUT    /api/portal/cs/partners/:id                     # 수정 (기본정보)
DELETE /api/portal/cs/partners/:id                     # 삭제
PATCH  /api/portal/cs/partners/:id/approve             # 승인
PATCH  /api/portal/cs/partners/:id/reject              # 반려
PATCH  /api/portal/cs/partners/:id/deactivate          # 비활성화 [신규]
PATCH  /api/portal/cs/partners/:id/margin              # 마진율 설정 [신규]
PATCH  /api/portal/cs/partners/:id/settlement-day      # 정산일자 설정 [신규]
GET    /api/portal/cs/partners/:id/settlements         # 파트너별 정산내역 조회 [신규]
POST   /api/portal/cs/partners/:id/settle              # 즉시 정산(송금이체) 실행 [신규]
```

**파트너 마진율 설정 Request Body**
```json
{ "margin_rate": 10.5 }
```

**파트너 정산일자 설정 Request Body**
```json
{ "settlement_day": 15 }
```

**즉시 정산 Request Body**
```json
{
  "period_start": "2026-03-01",
  "period_end": "2026-03-31",
  "note": "3월 정산"
}
```

**충전기 관리**
```
GET    /api/portal/cs/stations            # 목록 (상태/키워드 필터)
POST   /api/portal/cs/stations            # 충전기 등록
GET    /api/portal/cs/stations/:id        # 상세 (충전이력 + 장애이력)
PUT    /api/portal/cs/stations/:id        # 정보 수정
DELETE /api/portal/cs/stations/:id        # 소프트 삭제
POST   /api/portal/cs/stations/:id/faults # 장애이력 등록
GET    /api/portal/cs/stations/:id/faults # 장애이력 조회
```

**충전소 관리**
```
GET    /api/portal/cs/sites               # 충전소 목록
POST   /api/portal/cs/sites               # 충전소 등록 (신규 필드 포함)
GET    /api/portal/cs/sites/:id           # 상세
PUT    /api/portal/cs/sites/:id           # 수정
DELETE /api/portal/cs/sites/:id           # 삭제
```

**충전소 등록/수정 Request Body** [신규 필드 추가 — v1.1]
```json
{
  "site_name": "강남역 충전소",
  "partner_id": 5,
  "address": "서울시 강남구 강남대로 123",
  "charge_operator_name": "충전플러스",
  "manager_name": "홍길동",
  "manager_phone": "010-1234-5678",
  "unit_price": 280
}
```

**충전 이력**
```
GET /api/portal/cs/sessions?page=1&limit=20&startDate=&endDate=&siteId=&stationId=&userId=
```

**충전카드 관리** [신규 — v1.1]
```
GET    /api/portal/cs/id-tokens           # 충전카드 목록 (이용중 여부 포함)
GET    /api/portal/cs/id-tokens/:id       # 카드 상세
PATCH  /api/portal/cs/id-tokens/:id/block   # 카드 차단 (status=Blocked)
PATCH  /api/portal/cs/id-tokens/:id/unblock # 카드 차단 해제
```

**충전카드 목록 응답 예시**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "id_tag": "RFID-001",
        "status": "Accepted",
        "owner": { "id": 42, "username": "user01" },
        "in_use": true,
        "current_station_id": "EN1000001"
      }
    ],
    "total": 100
  }
}
```

> `in_use` 판단 기준: `IdToken.status = Accepted` AND `Transaction.status IN ('Pending', 'Active')`

**정산 관리 API** [신규 — v1.1]
```
GET /api/portal/cs/settlements?period=daily|weekly|monthly&startDate=&endDate=&page=1&limit=20
GET /api/portal/cs/settlements/by-user?userId=&startDate=&endDate=
GET /api/portal/cs/settlements/by-partner?partnerId=&startDate=&endDate=
GET /api/portal/cs/settlements/by-site?siteId=&startDate=&endDate=
GET /api/portal/cs/settlements/by-station?stationId=&startDate=&endDate=
POST /api/portal/cs/settlements/settle    # 즉시 정산 실행 (복수 파트너/기간 선택)
```

**충전기 프로비저닝 관리 API** [신규 — v1.1]
```
GET    /api/portal/cs/provisioning                      # 프로비저닝 목록 (status 필터)
POST   /api/portal/cs/provisioning                      # 시리얼번호 사전 등록
GET    /api/portal/cs/provisioning/:id                  # 상세
DELETE /api/portal/cs/provisioning/:id                  # 등록 취소
PATCH  /api/portal/cs/provisioning/:id/revoke           # 강제 무효화
POST   /api/portal/cs/stations/:id/reset-password       # 충전기 OCPP 비밀번호 재발급
```

**충전기 운영 API** [신규/확장 — v1.1]
```
GET /api/portal/cs/ops/online-stations                  # 현재 Online 충전기 목록
```

**시스템 운영**
```
GET /api/portal/cs/ops/variables                        # 운영변수 목록
PUT /api/portal/cs/ops/variables/:key                   # 운영변수 수정
GET /api/portal/cs/ops/messages?stationId=&action=&startDate=&endDate=&page=1&limit=20
                                                        # [v1.1] action 파라미터 추가 (메시지타입 필터)
```

**원격지원 API** [신규 — v1.1]
```
POST /api/portal/cs/ops/remote/update-firmware          # 펌웨어 다운로드 명령 (UpdateFirmware)
POST /api/portal/cs/ops/remote/get-diagnostics          # 진단 로그 요청
POST /api/portal/cs/ops/remote/change-configuration     # 운영변수 변경 (ChangeConfiguration)
```

**UpdateFirmware Request Body**
```json
{
  "station_id": "EN1000001",
  "location": "https://firmware.example.com/v2.1.bin",
  "retrieve_date": "2026-04-01T02:00:00Z"
}
```

### 4.3 파트너 API

```
GET  /api/portal/partner/dashboard                         # 내 충전소 현황 요약
GET  /api/portal/partner/sites                             # 내 충전소 목록
PUT  /api/portal/partner/sites/:id/price                   # 충전단가 수정
GET  /api/portal/partner/stations                          # 내 충전기 상태 목록 (30초 폴링용)
GET  /api/portal/partner/stats?period=current|previous     # 충전 통계 (당월/전월)
GET  /api/portal/partner/settlements?startDate=&endDate=   # 내 정산 내역 조회 [신규]
GET  /api/portal/partner/bank-account                      # 계좌정보 조회 [신규]
PUT  /api/portal/partner/bank-account                      # 계좌정보 등록/수정 [신규]
```

**계좌정보 등록/수정 Request Body** [신규 — v1.1]
```json
{
  "bank_name": "국민은행",
  "bank_account": "123-456-789012",
  "bank_account_holder": "홍길동"
}
```

### 4.4 고객 API

```
GET    /api/portal/customer/dashboard              # 고객 대시보드 (이번달 충전 요약)
GET    /api/portal/customer/history                # 내 충전이력 (페이지네이션)
GET    /api/portal/customer/rfid-cards             # 내 RFID 카드 목록
POST   /api/portal/customer/rfid-cards             # RFID 카드 등록
DELETE /api/portal/customer/rfid-cards/:id         # RFID 카드 삭제
GET    /api/portal/customer/payment-cards          # 내 결제카드 목록 [신규]
POST   /api/portal/customer/payment-cards          # 결제카드 등록 (후불결제용) [신규]
DELETE /api/portal/customer/payment-cards/:id      # 결제카드 삭제 [신규]
GET    /api/portal/customer/profile                # 프로필 조회
PUT    /api/portal/customer/profile                # 프로필 수정
```

**결제카드 등록 Request Body** [신규 — v1.1]
```json
{
  "nickname": "내 신한카드",
  "card_last4": "1234",
  "card_type": "Visa",
  "billing_key": ""
}
```

---

## 5. OCPP 관리 API (원격 명령)

```
POST /api/admin/stations/:stationId/remote-start        # RemoteStartTransaction
POST /api/admin/stations/:stationId/remote-stop         # RemoteStopTransaction
POST /api/admin/stations/:stationId/reset               # Reset (Hard/Soft)
POST /api/admin/stations/:stationId/availability        # ChangeAvailability
POST /api/admin/stations/:stationId/update-firmware     # UpdateFirmware [신규 — v1.1]
POST /api/admin/stations/:stationId/get-diagnostics     # GetDiagnostics [신규 — v1.1]
POST /api/admin/stations/:stationId/change-configuration # ChangeConfiguration [신규 — v1.1]
GET  /api/admin/stations/:stationId/status              # 현재 연결 상태 확인
```

---

## 6. Controller 구현 패턴

### 6.1 기본 Controller 패턴

```typescript
// src/controllers/charge.controller.ts
import { Request, Response, NextFunction } from 'express';
import { ChargeService } from '@services/charge.service';
import { startChargeSchema } from '@validators/charge.validator';

export class ChargeController {
  constructor(private chargeService: ChargeService) {}

  startCharge = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. 입력 유효성 검사 (Zod)
      const params = startChargeSchema.parse({
        qrCode: req.query.qr_code,
        userId: req.query.user_id,
        goalType: req.query.goal_type,
        goalValue: req.query.goal_value ? Number(req.query.goal_value) : undefined,
      });

      // 2. 서비스 호출
      const result = await this.chargeService.startCharge(params);

      // 3. 앱 스펙 응답 형식 유지
      res.json({ success: true, sessionId: result.sessionId });
    } catch (error) {
      next(error);
    }
  };

  getStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) {
        res.status(400).json({ detail: 'session_id is required' });
        return;
      }

      const status = await this.chargeService.getStatus(sessionId);
      if (!status) {
        res.status(404).json({ detail: '존재하지 않는 충전 세션입니다.' });
        return;
      }

      res.json(status);
    } catch (error) {
      next(error);
    }
  };
}
```

### 6.2 Zod 유효성 검사기 패턴

```typescript
// src/validators/charge.validator.ts
import { z } from 'zod';

export const startChargeSchema = z.object({
  qrCode: z.string().min(1, 'qr_code is required'),
  userId: z.string().min(1, 'user_id is required'),
  goalType: z.enum(['time', 'kwh', 'amount', 'free']),
  goalValue: z.number().positive().optional(),
}).refine(
  (data) => data.goalType === 'free' || data.goalValue !== undefined,
  { message: 'goal_value is required unless goal_type is free' }
);

export type StartChargeParams = z.infer<typeof startChargeSchema>;
```

### 6.3 라우터 등록 패턴

```typescript
// src/routes/charge.routes.ts
import { Router } from 'express';
import { ChargeController } from '@controllers/charge.controller';
import { chargeService } from '@services/charge.service';
import { authMiddleware } from '@middlewares/auth.middleware';

const router = Router();
const controller = new ChargeController(chargeService);

router.post('/start', authMiddleware, controller.startCharge);
router.get('/status', authMiddleware, controller.getStatus);
router.post('/stop', authMiddleware, controller.stopCharge);

export default router;
```

---

## 7. 요금 계산 규칙

| 항목 | 규칙 |
|------|------|
| 기본 단가 | 충전소별 `unit_price` (원/kWh, 기본값 250원) |
| 최종 요금 계산 | `Math.floor(totalKwh * unitPrice)` |
| 소수점 처리 | 원 단위 정수로 내림 |
| 앱 내부 계산 | 앱은 250원/kWh 고정으로 목표 달성 여부 판단 (서버와 별개) |
| 최종 정산 | 서버에서 계산하여 `/api/charge/stop` 응답에 포함 |

---

## 8. 체크리스트

- [ ] 모바일 충전 API 엔드포인트 구현 (기존 앱 스펙 호환)
- [ ] 포털 CS/파트너/고객 API 구현
- [ ] 역할 기반 미들웨어 적용 확인
- [ ] Zod 유효성 검사 모든 엔드포인트 적용
- [ ] 페이지네이션 공통 유틸리티 구현
- [ ] 에러 응답 형식 일관성 확인
- [ ] 동일 충전기 중복 세션 방지 로직 구현
- [ ] 요금 계산 로직 서비스 레이어에 구현
- [ ] `Accept-Language` 헤더 파싱 미들웨어(i18next-http-middleware) 등록 확인
- [ ] 에러 응답의 `message` 필드가 Accept-Language 기반 다국어로 반환되는지 확인
- [ ] 모바일 앱 API `detail` 필드도 다국어 메시지로 반환되는지 확인
- [ ] [v1.1 신규] `POST /provision` 엔드포인트 구현 (Rate Limiting 강화 포함)
- [ ] [v1.1 신규] 파트너 마진율/정산일자 수정 API 구현
- [ ] [v1.1 신규] 즉시 정산(송금이체) API 구현 + Settlement 레코드 생성
- [ ] [v1.1 신규] 정산 관리 API (사용자별/파트너별/충전소별/기기별) 구현
- [ ] [v1.1 신규] 충전소 등록 시 충전사업자/관리자 필드 포함
- [ ] [v1.1 신규] 충전카드 목록 이용중 여부 실시간 표시 API
- [ ] [v1.1 신규] 고객 Inactive 시 IdToken 자동 Blocked 처리 로직
- [ ] [v1.1 신규] 파트너 계좌정보 등록/수정 API 구현
- [ ] [v1.1 신규] 고객 결제카드 등록/삭제 API 구현
- [ ] [v1.1 신규] OCPP 메시지 로그 조회 시 `action` 파라미터 필터 적용
- [ ] [v1.1 신규] UpdateFirmware / GetDiagnostics / ChangeConfiguration 원격지원 API 구현
- [ ] [v1.1 신규] CS 포탈 시리얼번호 사전 등록 API (provisioning 관리) 구현
- [ ] [v1.2 신규] `GET /api/portal/cs/provisioning?keyword=` 키워드 검색 구현
- [ ] [v1.2 신규] `POST /api/portal/cs/provisioning/bulk-upload` CSV 일괄 등록 구현
- [ ] [v1.2 신규] `GET /api/portal/cs/provisioning/sample-csv` 샘플 CSV 다운로드 구현
- [ ] [v1.2 신규] `PUT /api/portal/cs/provisioning/:id` 프로비저닝 수정 API 구현
- [ ] [v1.2 신규] `GET|POST|PUT|DELETE /api/portal/cs/provisioning/configs` ChargerConfig CRUD 구현
- [ ] [v1.2 신규] `GET /api/portal/cs/fault-logs?keyword=` 장애로그 키워드 필터 구현
- [ ] [v1.2 신규] `POST /api/portal/cs/settlements/manual` 수동 정산 생성 API 구현
- [ ] [v1.2 신규] `PATCH /api/portal/cs/settlements/:id/status` 정산 상태 변경 API 구현
- [ ] [v1.2 신규] `GET /api/portal/cs/refunds` 환불 이력 조회 API 구현
- [ ] [v1.2 신규] `PATCH /api/portal/cs/refunds/:id/status` 환불 상태 변경 API 구현
- [ ] [v1.2 신규] BullMQ settlement 큐 일별/주별/월별 배치 정산 구현
- [ ] [v1.2 신규] stopTransaction 시 goalType='amount'이면 자동 RefundLog 생성 구현
