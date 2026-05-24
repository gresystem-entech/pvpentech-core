# 사용자 시나리오 구현 계획 (결제 연동 - MB Bank)

- **작성일**: 2026-04-17
- **참조**: `documents/design_ref/customer_scenario.md`
- **버전**: 2.0 (확정)

---

## 1. 확정된 설계 방향

| 항목 | 결정 내용 |
|------|-----------|
| 통화 | KRW → **VND 전면 전환** |
| free 모드 | 사용자가 결제수단 등록 → 즉시 충전(후불), 미등록 → 선결제 필요 |
| PG 설정 관리 | CS 포탈 정산관리 화면에서 등록/수정 (DB 저장, 다중 설정 지원) |
| 결제 타임아웃 | PG 설정 항목으로 관리 (기본값 10분) |
| PG | MB Bank (Paygate) |

---

## 2. MB Bank 연동 정보 (Sandbox)

> ⚠️ 실제 값은 DB PgConfig 테이블에 저장. 하드코딩 금지.

| 항목 | Sandbox 값 |
|------|------------|
| `hashKey` (MAC 서명용) | `6ca6af4578753e1afae2eb864f8aa288` |
| `access_code` | `DNHXPHRNMZ` |
| `merchant_id` | `114743` |
| `invoice_taxcode` | `0101243150-572` |

### API 엔드포인트 (Sandbox)

| 기능 | URL |
|------|-----|
| 주문 생성 | `https://BE.mbbank.com.vn/pg-paygate/ite-pg-paygate/paygate/v2/create-order` |
| 환불 | `https://BE.mbbank.com.vn/pg-paygate/ite-pg-paygate/paygate/refund/single` |
| 거래 조회 | `https://BE.mbbank.com.vn/pg-paygate/ite-pg-paygate/paygate/detail` |

---

## 3. 현재 구현 상태

### 이미 완료
| API | 경로 | 상태 |
|-----|------|------|
| 로그인 | `POST /api/login` | ✅ |
| 충전 상태 조회 | `GET /api/charge/status` | ✅ |
| 충전 종료 | `POST /api/charge/stop` | ✅ (통화 필드만 VND로 변경) |

### 수정 필요
| API | 경로 | 변경 내용 |
|-----|------|-----------|
| 충전 시작 | `POST /api/charge/start` | `amount` 응답 추가, RemoteStart 지연, free 모드 분기 |

### 신규 구현
| API | 경로 |
|-----|------|
| 결제 요청 | `POST /api/payment/create` |
| 결제 완료 webhook | `POST /api/payment/ipn` |
| 결제 상태 조회 | `GET /api/payment/status/:orderRef` |
| Mock 결제 완료 | `POST /api/payment/mock-complete/:orderRef` |

---

## 4. 새로운 플로우

### 4-1. 선결제 플로우 (kwh / amount / time 모드, 또는 free + 결제수단 미등록)

```
앱: POST /api/charge/start
  └→ 충전기 확인, 세션 생성 (status=Pending, paymentStatus=pending)
  └→ amount 계산 (VND)
  └→ 응답: { sessionId, amount }

앱: POST /api/payment/create
  └→ PgConfig 조회 (활성 설정)
  └→ MB Bank 주문 생성 API 호출 (MAC 서명 포함)
  └→ PaymentOrder DB 저장
  └→ 응답: { order_reference, payment_url, is_mock, device }

[사용자가 MB Bank 앱/웹에서 결제 완료]

MB Bank → 서버: POST /api/payment/ipn
  └→ MAC 서명 검증
  └→ error_code='00' → 결제 성공
  └→ Transaction.paymentStatus = paid
  └→ RemoteStart 전송 → 충전 시작

앱: GET /api/payment/status/:orderRef (폴링)
  └→ status=PAID 확인 → 충전 화면 전환

앱: GET /api/charge/status?session_id=... (폴링, 60초마다)
앱: POST /api/charge/stop?session_id=...
  └→ 응답: { kwh, cost, currency: "VND", message }
```

### 4-2. 후불 플로우 (free 모드 + 결제수단 등록된 사용자)

```
앱: POST /api/charge/start  (goal_type=free)
  └→ 사용자 결제수단 확인 → PaymentCard 존재
  └→ 즉시 RemoteStart 전송
  └→ 응답: { sessionId, amount: "0" }

앱: GET /api/charge/status (폴링)

앱: POST /api/charge/stop
  └→ 실제 충전량 계산 → 후불 결제 처리 (billingKey로 자동 결제)
  └→ 응답: { kwh, cost, currency: "VND", message }
```

---

## 5. 데이터 모델 변경

### 5-1. 신규 모델: PgConfig (PG 설정)

```prisma
model PgConfig {
  id                Int      @id @default(autoincrement())
  name              String   @db.VarChar(100)   // "MB Bank Sandbox"
  pgType            String   @db.VarChar(50)    // "mbbank"
  isActive          Boolean  @default(false)     // 활성 PG (1개만 active)
  isSandbox         Boolean  @default(true)

  // API 인증
  accessCode        String   @db.VarChar(100)
  merchantId        String   @db.VarChar(100)
  hashKey           String   @db.VarChar(255)   // MAC 서명 비밀키
  invoiceTaxcode    String?  @db.VarChar(50)

  // 엔드포인트
  createOrderUrl    String   @db.VarChar(500)
  refundUrl         String   @db.VarChar(500)
  detailUrl         String   @db.VarChar(500)

  // 콜백 URL (우리 서버)
  ipnUrl            String   @db.VarChar(500)
  returnUrl         String   @db.VarChar(500)
  cancelUrl         String   @db.VarChar(500)

  // 운영 설정
  currency          String   @default("VND") @db.VarChar(10)
  paymentTimeoutMin Int      @default(10)      // 결제 타임아웃 (분)

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  paymentOrders     PaymentOrder[]

  @@map("pg_config")
}
```

### 5-2. 신규 모델: PaymentOrder (결제 주문)

```prisma
model PaymentOrder {
  id               Int           @id @default(autoincrement())
  sessionId        String        @db.VarChar(100)
  pgConfigId       Int
  orderReference   String        @unique @db.VarChar(100)   // 우리 생성 거래번호
  amount           Decimal       @db.Decimal(12, 2)
  currency         String        @default("VND") @db.VarChar(10)
  paymentMethod    String?       @db.VarChar(20)             // QR | ATMCARD
  status           PayOrderStatus @default(PENDING)
  isMock           Boolean       @default(false)

  // MB Bank 응답
  pgSessionId      String?       @db.VarChar(200)
  paymentUrl       String?       @db.VarChar(1000)
  qrUrl            String?       @db.VarChar(1000)
  expireTime       DateTime?

  // IPN 수신 후 채워짐
  pgTransactionNo  String?       @db.VarChar(200)
  issuerTxnRef     String?       @db.VarChar(200)
  ipnReceivedAt    DateTime?
  ipnRawPayload    String?       @db.Text

  // 타임아웃 처리
  expiresAt        DateTime?     // 결제 타임아웃 시각

  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  pgConfig         PgConfig      @relation(fields: [pgConfigId], references: [id])

  @@index([sessionId])
  @@index([status])
  @@index([expiresAt])
  @@map("payment_order")
}

enum PayOrderStatus {
  PENDING
  PAID
  FAILED
  REFUNDED
  CANCELLED
  TIMEOUT
}
```

### 5-3. Transaction 모델 수정
- `costKrw` → `costVnd` (컬럼명 변경)
- `unitPriceKrw` → `unitPriceVnd`
- `DEFAULT_UNIT_PRICE_KRW` env → `DEFAULT_UNIT_PRICE_VND`

---

## 6. amount 계산 로직 (VND)

| goalType | 계산 | 예시 |
|----------|------|------|
| `kwh` | `goalValue × unitPriceVnd` | 10kWh × 3,500 = 35,000 VND |
| `amount` | `goalValue` (그대로) | 50,000 VND |
| `time` | `(minutes/60) × 7.0kW × unitPriceVnd` | 30분 × 3.5kWh × 3,500 = 12,250 VND |
| `free` | `0` (결제수단 있으면 후불, 없으면 예치금 방식 미정) |

> `unitPriceVnd`: 충전소 단가 우선, 없으면 env `DEFAULT_UNIT_PRICE_VND` 사용 (기본값: 3500)

---

## 7. MAC 서명 생성

### 주문 생성 요청 (MD5)

서명 대상 필드를 **사전순 정렬** 후 `&` 연결, 맨 뒤에 `&hashkey={hashKey}` 추가:
```
access_code=DNHXPHRNMZ&amount=35000.00&...&hashkey=6ca6af4578753e1afae2eb864f8aa288
```
→ **MD5** 해시 → 대문자 HEX

### IPN webhook 검증 (SHA256)

MB Bank가 보낸 모든 파라미터를 사전순 정렬 + hashkey 연결 → **SHA256** 해시.
`mac` 필드와 비교, 불일치 시 즉시 400 반환.

---

## 8. 결제 타임아웃 처리

- `PaymentOrder` 생성 시 `expiresAt = now() + pgConfig.paymentTimeoutMin분`
- **cron job** (1분마다 실행):
  - `expiresAt < now()` AND `status = PENDING` 인 주문 → `TIMEOUT` 처리
  - 연결된 Transaction → `Failed` 처리
- 타임아웃된 세션에 대해 `charge/status` 조회 시 `failed` 상태 반환

---

## 9. CS 포탈 UI: PG 설정 관리

"정산관리" 메뉴 아래 **"PG 설정"** 탭 추가.

### 목록 화면
| 컬럼 | 내용 |
|------|------|
| ID | |
| 설정명 | MB Bank Sandbox |
| PG 유형 | mbbank |
| 상태 | 활성 / 비활성 |
| Sandbox | Y/N |
| 결제 타임아웃 | 10분 |
| 등록일 | |
| 액션 | 상세/수정, 활성화, 삭제 |

### 등록/수정 모달 필드
- 설정명 (text)
- PG 유형 (select: mbbank)
- Sandbox 여부 (toggle)
- access_code (text)
- merchant_id (text)
- hashKey (password 형식, 수정 시 마스킹)
- invoice_taxcode (text)
- 주문생성 URL (text)
- 환불 URL (text)
- 거래조회 URL (text)
- IPN URL (text, 자동 설정: `https://{서버}/api/payment/ipn`)
- Return URL (text)
- Cancel URL (text)
- 결제 타임아웃 (number, 단위: 분)
- 통화 (select: VND / KRW)

> "활성화" 버튼: 해당 설정을 활성 PG로 지정 (기존 활성 설정은 자동 비활성화)

---

## 10. 구현할 파일 목록

### 신규 생성
| 파일 | 역할 |
|------|------|
| `src/services/payment.service.ts` | MB Bank API 연동, 결제 생성/IPN/상태조회, 타임아웃 처리 |
| `src/services/pgConfig.service.ts` | PG 설정 CRUD |
| `src/controllers/payment.controller.ts` | 결제 API 핸들러 |
| `src/controllers/pgConfig.controller.ts` | PG 설정 API 핸들러 |
| `src/routes/payment.routes.ts` | `/api/payment/*` 라우터 |
| `src/routes/portal/cs/pgConfig.routes.ts` | `/api/portal/cs/pg-configs/*` 라우터 |
| `src/jobs/paymentTimeout.job.ts` | 결제 타임아웃 cron job |
| `prisma/migrations/XXXXX_payment_pg_config/migration.sql` | 마이그레이션 |

### 수정
| 파일 | 변경 내용 |
|------|-----------|
| `prisma/schema.prisma` | PgConfig, PaymentOrder 모델 추가; costKrw → costVnd |
| `src/services/charge.service.ts` | amount 계산, RemoteStart 지연, free 모드 분기 |
| `src/services/refund.service.ts` | VND로 단위 변경 |
| `src/config/env.ts` | DEFAULT_UNIT_PRICE_VND 추가 |
| `src/routes/index.ts` | payment, pgConfig 라우터 등록 |
| `public/portal/cs/index.html` | 정산관리에 PG 설정 탭 추가 |

---

## 11. 구현 순서

```
1단계: DB 모델
  - schema.prisma 수정 (PgConfig, PaymentOrder, VND 변경)
  - 마이그레이션 생성

2단계: PG 설정 관리 (백엔드)
  - pgConfig.service.ts
  - pgConfig.controller.ts
  - pgConfig.routes.ts

3단계: 결제 서비스 (백엔드)
  - payment.service.ts (MB Bank API 연동, MAC 서명, IPN 처리)
  - payment.controller.ts
  - payment.routes.ts
  - paymentTimeout.job.ts (cron)

4단계: 충전 서비스 수정
  - charge.service.ts (amount 반환, RemoteStart 지연, free 분기)

5단계: CS 포탈 UI
  - 정산관리 > PG 설정 탭 추가

6단계: 테스트
  - Mock 모드로 전체 플로우 검증
  - Sandbox 환경 실제 연동 테스트
```

---

## 12. Mock 모드

`PgConfig.isSandbox = true` + 별도 mock 플래그 또는 `MB_BANK_IS_MOCK=true` 환경변수:

- MB Bank API 실제 호출 없이 mock 응답 반환
- `payment_url` = 내부 mock 페이지 URL
- `is_mock: true` 응답
- 개발자용 수동 IPN 트리거: `POST /api/payment/mock-complete/:orderRef`
  - 즉시 IPN 처리 + RemoteStart 전송 시뮬레이션
