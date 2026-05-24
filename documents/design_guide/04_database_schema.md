# 04. PostgreSQL 데이터베이스 스키마 설계 가이드

- **버전**: v1.2
- **작성일**: 2026-03-31
- **업데이트**: 2026-04-15 (v1.2 — payment_settlement.md 반영: Transaction 결제필드, RefundLog, ChargerConfig, SettlementSchedule 추가)
- **대상**: Node.js 백엔드 개발자
- **참조**: `design_ref/03_db_design_guide.md`, `design_ref/06_portal_implementation_plan.md`, `design_ref/usage_scenario.txt`

---

## 1. 개요 (Overview)

Pvpentech CSMS의 PostgreSQL 데이터베이스 스키마를 Prisma ORM 기준으로 정의합니다.
OCPP 1.6 스펙의 데이터 구조와 포털/앱 요구사항을 반영합니다.

### 도메인 분류

| 도메인 | 테이블 | 설명 |
|--------|--------|------|
| 기기 관리 | `charging_station`, `connector` | 충전기, 커넥터 |
| 프로비저닝 | `charger_provisioning`, `station_id_sequence` | 충전기 최초 설치 등록 |
| 사용자/인증 | `user`, `partner_profile`, `id_token` | 사용자, 파트너, RFID 토큰 |
| 트랜잭션 | `transaction`, `meter_value` | 충전 세션, 계량 데이터 |
| 충전소 | `charging_site` | 충전소 (파트너 소속, 충전사업자/관리자 정보 포함) |
| 결제 | `payment_card` | 사용자 결제 카드 |
| 정산 | `settlement` | 파트너별/충전소별/기기별 정산 이력 |
| 운영 | `ocpp_message`, `fault_log`, `csms_variable` | 로그, 장애이력, 운영변수 |

---

## 2. Prisma 스키마 전체 정의

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─────────────────────────────────────────────
// 기기 및 충전소 관리
// ─────────────────────────────────────────────

model ChargingStation {
  id               String    @id @db.VarChar(50)   // "EN" + 7자리 숫자 형식 (프로비저닝 후 발급)
  modelName        String?   @db.VarChar(100)
  vendorName       String?   @db.VarChar(100)      // 제조사명 (BootNotification에서 업데이트)
  manufacturer     String?   @db.VarChar(100)      // [신규] CS 등록 시 입력 제조사명
  firmwareVersion  String?   @db.VarChar(50)
  serialNumber     String?   @db.VarChar(100)
  passwordHash     String?   @db.VarChar(255)      // [신규] OCPP Basic Auth 비밀번호 해시
  status           StationStatus @default(Offline)
  lastHeartbeatAt  DateTime?
  isActive         Boolean   @default(true)
  siteId           Int?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  site             ChargingSite?       @relation(fields: [siteId], references: [id])
  connectors       Connector[]
  transactions     Transaction[]
  deviceVariables  DeviceVariable[]
  ocppMessages     OcppMessage[]
  faultLogs        FaultLog[]
  provisioning     ChargerProvisioning?

  @@map("charging_station")
}

enum StationStatus {
  Online
  Offline
  Faulted
}

model Connector {
  id              Int       @id @default(autoincrement())
  stationId       String    @db.VarChar(50)
  connectorId     Int       // OCPP connector number (1 이상)
  connectorType   String?   @db.VarChar(30)  // cCCS1, cCCS2, cType2 등
  currentStatus   ConnectorStatus @default(Available)
  updatedAt       DateTime  @updatedAt

  station         ChargingStation @relation(fields: [stationId], references: [id])

  @@unique([stationId, connectorId])
  @@map("connector")
}

enum ConnectorStatus {
  Available
  Preparing
  Charging
  SuspendedEVSE
  SuspendedEV
  Finishing
  Reserved
  Unavailable
  Faulted
}

model ChargingSite {
  id                   Int       @id @default(autoincrement())
  siteName             String    @db.VarChar(200)
  address              String?   @db.VarChar(500)
  unitPrice            Decimal   @default(250) @db.Decimal(10, 2)  // 원/kWh
  partnerId            Int?
  chargeOperatorName   String?   @db.VarChar(200)  // [신규] 충전사업자명
  managerName          String?   @db.VarChar(100)  // [신규] 충전소 관리자 이름
  managerPhone         String?   @db.VarChar(20)   // [신규] 충전소 관리자 전화번호
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  partner          PartnerProfile?    @relation(fields: [partnerId], references: [id])
  chargingStations ChargingStation[]
  settlements      Settlement[]

  @@map("charging_site")
}

// ─────────────────────────────────────────────
// 사용자 및 인증
// ─────────────────────────────────────────────

model User {
  id           Int       @id @default(autoincrement())
  username     String    @unique @db.VarChar(150)
  passwordHash String    @db.VarChar(255)
  email        String?   @db.VarChar(254)
  firstName    String?   @db.VarChar(50)
  lastName     String?   @db.VarChar(50)
  phone        String?   @db.VarChar(20)
  role         UserRole  @default(customer)
  status       UserStatus @default(active)
  isActive     Boolean   @default(true)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  partnerProfile PartnerProfile?
  paymentCards   PaymentCard[]
  idTokens       IdToken[]

  @@map("user")
}

enum UserRole {
  cs
  partner
  customer
}

enum UserStatus {
  pending
  active
  inactive
}

model PartnerProfile {
  id              Int       @id @default(autoincrement())
  userId          Int       @unique
  businessName    String    @db.VarChar(200)
  businessNo      String?   @db.VarChar(20)
  contactPhone    String?   @db.VarChar(20)
  // [신규] 정산 관련 필드
  marginRate      Decimal   @default(0) @db.Decimal(5, 2)  // 마진율 % (예: 10.00 = 10%)
  settlementDay   Int?      @db.SmallInt                    // 정산일 (1~28, null=미설정)
  // [신규] 계좌정보 (정산금 수령용)
  bankName        String?   @db.VarChar(100)  // 은행명
  bankAccount     String?   @db.VarChar(50)   // 계좌번호
  bankAccountHolder String? @db.VarChar(100)  // 예금주
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  user          User             @relation(fields: [userId], references: [id])
  chargingSites ChargingSite[]
  settlements   Settlement[]

  @@map("partner_profile")
}

model PaymentCard {
  id         Int      @id @default(autoincrement())
  userId     Int
  nickname   String?  @db.VarChar(100)
  cardLast4  String   @db.VarChar(4)
  cardType   String?  @db.VarChar(50)   // Visa, Mastercard, 국내카드 등
  billingKey String?  @db.VarChar(500)  // PG 빌링키 (추후 PG 연동)
  isDefault  Boolean  @default(false)
  createdAt  DateTime @default(now())

  user       User     @relation(fields: [userId], references: [id])

  @@map("payment_card")
}

// OCPP IdTag 인증 정보 (RFID 카드 등)
model IdToken {
  id         Int       @id @default(autoincrement())
  idTag      String    @unique @db.VarChar(50)  // RFID 태그 값
  type       IdTokenType @default(ISO14443)
  status     IdTokenStatus @default(Accepted)
  expiryDate DateTime?
  userId     Int?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  user         User?         @relation(fields: [userId], references: [id])
  transactions Transaction[]

  @@map("id_token")
}

enum IdTokenType {
  Central
  eMAID
  ISO14443
  ISO15693
  KeyCode
  Local
  MacAddress
  NoAuthorization
}

enum IdTokenStatus {
  Accepted
  Blocked
  Expired
  Invalid
  ConcurrentTx
}

// ─────────────────────────────────────────────
// 트랜잭션 및 계량
// ─────────────────────────────────────────────

model Transaction {
  id               Int       @id @default(autoincrement())
  sessionId        String    @unique @db.VarChar(100)  // 앱에 노출되는 세션 ID
  ocppTransactionId Int?     // StartTransaction 응답으로 받는 OCPP transactionId
  stationId        String    @db.VarChar(50)
  connectorId      Int
  idTag            String?   @db.VarChar(50)
  goalType         GoalType? // 앱에서 설정한 충전 목표
  goalValue        Decimal?  @db.Decimal(10, 2)
  status           TransactionStatus @default(Pending)
  meterStart       Int       @default(0)  // Wh
  meterEnd         Int?
  timeStart        DateTime  @default(now())
  timeEnd          DateTime?
  costKrw          Int?      // 최종 요금 (원)
  failReason       String?   @db.VarChar(255)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  station          ChargingStation @relation(fields: [stationId], references: [id])
  idTokenRecord    IdToken?        @relation(fields: [idTag], references: [idTag])
  meterValues      MeterValue[]

  @@index([stationId])
  @@index([timeStart])
  @@index([status])
  @@map("transaction")
}

enum TransactionStatus {
  Pending    // RemoteStart 전송, 차량 연결 대기
  Active     // 충전 중
  Stopped    // 정상 종료
  Failed     // 실패 (차량 미연결 등)
}

enum GoalType {
  time
  kwh
  amount
  free
}

// 시계열 계량 데이터 — 데이터량이 많으므로 파티셔닝 권장
model MeterValue {
  id            Int       @id @default(autoincrement())
  transactionId Int
  timestamp     DateTime
  measurand     String    @db.VarChar(100)  // Energy.Active.Import.Register, Voltage 등
  value         Decimal   @db.Decimal(12, 4)
  unit          String?   @db.VarChar(20)   // Wh, kWh, V, A, W 등
  phase         String?   @db.VarChar(10)
  createdAt     DateTime  @default(now())

  transaction   Transaction @relation(fields: [transactionId], references: [id])

  @@index([transactionId, timestamp])
  @@map("meter_value")
}

// ─────────────────────────────────────────────
// 기기 설정 변수
// ─────────────────────────────────────────────

model DeviceVariable {
  id            Int     @id @default(autoincrement())
  stationId     String  @db.VarChar(50)
  componentName String  @db.VarChar(100)  // 예: 'AuthCtrlr'
  variableName  String  @db.VarChar(100)  // 예: 'AuthorizeRemoteStart'
  variableValue String? @db.Text
  isReadonly    Boolean @default(false)
  updatedAt     DateTime @updatedAt

  station       ChargingStation @relation(fields: [stationId], references: [id])

  @@unique([stationId, componentName, variableName])
  @@map("device_variable")
}

// ─────────────────────────────────────────────
// 운영 로그 및 설정
// ─────────────────────────────────────────────

model OcppMessage {
  id         Int      @id @default(autoincrement())
  stationId  String   @db.VarChar(50)
  messageId  String   @db.VarChar(100)
  direction  Int      // 2=CP→CSMS(Call), 3=CSMS→CP(CallResult), 4=Error
  action     String?  @db.VarChar(50)
  payload    String   @db.Text
  createdAt  DateTime @default(now())

  station    ChargingStation @relation(fields: [stationId], references: [id])

  @@index([stationId, createdAt])
  @@index([createdAt])
  @@index([action])             // [신규] 메시지타입별 검색 (예: BootNotification, Heartbeat)
  @@index([stationId, action])  // [신규] 충전기+타입 복합 검색
  @@map("ocpp_message")
}

model FaultLog {
  id          Int       @id @default(autoincrement())
  stationId   String    @db.VarChar(50)
  reportedAt  DateTime  @default(now())
  faultType   FaultType
  description String?   @db.Text
  resolvedAt  DateTime?
  reportedBy  String?   @db.VarChar(150)  // CS 담당자 username
  createdAt   DateTime  @default(now())

  station     ChargingStation @relation(fields: [stationId], references: [id])

  @@index([stationId])
  @@index([resolvedAt])          // [신규] 미처리 장애건수 집계 (WHERE resolvedAt IS NULL)
  @@map("fault_log")
}

enum FaultType {
  ConnectorFault       // 커넥터 불량
  CommunicationError   // 통신 오류
  PowerFault           // 전원 불량
  Other                // 기타
}

// ─────────────────────────────────────────────
// 프로비저닝 (충전기 최초 설치 등록) [신규]
// ─────────────────────────────────────────────

model ChargerProvisioning {
  id              Int                  @id @default(autoincrement())
  serialNumber    String               @unique @db.VarChar(100)  // 제조사 시리얼번호
  stationId       String?              @unique @db.VarChar(50)   // 프로비저닝 후 발급된 "EN" + 7자리
  status          ProvisioningStatus   @default(registered)
  registeredBy    String?              @db.VarChar(150)  // CS 담당자 username (사전 등록자)
  provisionedAt   DateTime?            // 프로비저닝 완료 시각
  rejectedAt      DateTime?            // Reject 처리 시각
  rejectReason    String?              @db.VarChar(255)
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  chargingStation ChargingStation?     @relation(fields: [stationId], references: [id])

  @@index([serialNumber])
  @@index([status])
  @@map("charger_provisioning")
}

enum ProvisioningStatus {
  registered    // CS가 사전 등록 (프로비저닝 대기)
  provisioned   // 프로비저닝 완료 (충전기 접속정보 수신 완료)
  rejected      // 거부됨 (미등록 시리얼번호)
  revoked       // 관리자 수동 무효화
}

// 충전기 아이디 시퀀스 관리 ("EN" + 7자리 숫자)
model StationIdSequence {
  id          Int   @id @default(1)
  lastNumber  Int   @default(1000000)  // 다음 발급 번호 -1 (increment 후 사용)

  @@map("station_id_sequence")
}

// ─────────────────────────────────────────────
// 정산 [신규]
// ─────────────────────────────────────────────

model Settlement {
  id              Int              @id @default(autoincrement())
  partnerId       Int              // 파트너
  siteId          Int?             // 충전소 (null = 파트너 전체 합산)
  stationId       String?          @db.VarChar(50)  // 충전기 (null = 충전소 전체 합산)
  periodType      SettlementPeriod // 정산 기준 기간 단위
  periodStart     DateTime         // 정산 기간 시작
  periodEnd       DateTime         // 정산 기간 종료
  totalKwh        Decimal          @db.Decimal(12, 4)  // 총 충전량
  totalAmount     Int              // 총 충전금액 (원)
  marginRate      Decimal          @db.Decimal(5, 2)   // 정산 시점 마진율 스냅샷
  settlementAmount Int             // 파트너 정산금액 (totalAmount × marginRate / 100)
  paidAmount      Int              @default(0)  // 실제 송금 완료금액
  status          SettlementStatus @default(pending)
  settledAt       DateTime?        // 송금 완료 시각
  settledBy       String?          @db.VarChar(150)  // CS 담당자 username
  note            String?          @db.VarChar(500)
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  partner         PartnerProfile   @relation(fields: [partnerId], references: [id])
  site            ChargingSite?    @relation(fields: [siteId], references: [id])

  @@index([partnerId, periodStart])
  @@index([siteId, periodStart])
  @@index([status])
  @@map("settlement")
}

enum SettlementPeriod {
  daily
  weekly
  monthly
  instant   // 즉시 정산
}

enum SettlementStatus {
  pending    // 정산 대기
  completed  // 송금 완료
  cancelled  // 취소됨
}

// 시스템 운영 변수 (관리자가 포털에서 설정)
model CsmsVariable {
  id          Int      @id @default(autoincrement())
  key         String   @unique @db.VarChar(100)
  value       String   @db.VarChar(500)
  description String?  @db.VarChar(500)
  updatedAt   DateTime @updatedAt

  @@map("csms_variable")
}
```

---

## 3. 주요 인덱스 전략

| 테이블 | 인덱스 컬럼 | 이유 |
|--------|------------|------|
| `transaction` | `station_id` | 충전기별 이력 조회 |
| `transaction` | `time_start` | 기간 검색 |
| `transaction` | `status` | 활성 세션 필터 |
| `meter_value` | `(transaction_id, timestamp)` | 시계열 조회 |
| `ocpp_message` | `(station_id, created_at)` | 충전기별 메시지 조회 |
| `ocpp_message` | `created_at` | 만료 데이터 삭제 |
| `ocpp_message` | `action` | 메시지 타입별 검색 (usage_scenario 반영) |
| `ocpp_message` | `(station_id, action)` | 충전기+메시지타입 복합 검색 |
| `fault_log` | `station_id` | 충전기별 장애이력 |
| `fault_log` | `resolved_at` | 미처리 장애건수 집계 (`WHERE resolved_at IS NULL`) |
| `charger_provisioning` | `serial_number` | 시리얼번호 조회 (프로비저닝 핵심 키) |
| `charger_provisioning` | `status` | 상태별 필터 (registered/provisioned) |
| `settlement` | `(partner_id, period_start)` | 파트너별 정산 기간 조회 |
| `settlement` | `(site_id, period_start)` | 충전소별 정산 기간 조회 |
| `settlement` | `status` | 미정산 건수 집계 |

---

## 4. MeterValue 파티셔닝 전략

MeterValue는 충전기 수와 충전 빈도에 비례하여 데이터가 급증합니다. PostgreSQL 범위 파티셔닝을 권장합니다.

```sql
-- 월별 파티셔닝 예시 (Prisma 마이그레이션 후 수동 적용)
ALTER TABLE meter_value RENAME TO meter_value_template;

CREATE TABLE meter_value (
  LIKE meter_value_template INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- 파티션 생성 (매월 생성 필요)
CREATE TABLE meter_value_2026_03
  PARTITION OF meter_value
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE meter_value_2026_04
  PARTITION OF meter_value
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

> **주의**: Prisma는 파티셔닝을 직접 지원하지 않으므로, 마이그레이션 후 SQL로 수동 적용합니다.

---

## 5. 시드 데이터 (초기 운영 변수)

```typescript
// scripts/seed.ts
import { prisma } from '@config/database';

async function seed() {
  await prisma.csmsVariable.createMany({
    data: [
      {
        key: 'ocpp_message_log_retention_days',
        value: '30',
        description: 'OCPP 메시지 로그 보관 기간 (일)',
      },
      {
        key: 'heartbeat_interval_seconds',
        value: '60',
        description: 'Heartbeat 주기 (초)',
      },
      {
        key: 'session_pending_timeout_minutes',
        value: '5',
        description: '충전 대기(Pending) 상태 타임아웃 (분)',
      },
    ],
    skipDuplicates: true,
  });

  console.log('Seed completed');
}

seed().finally(() => prisma.$disconnect());
```

---

## 6. 네이밍 규칙

| 항목 | 규칙 | 예시 |
|------|------|------|
| 테이블명 | snake_case (Prisma `@@map`) | `charging_station` |
| 컬럼명 | camelCase (Prisma 기본) → snake_case DB | `stationId` → `station_id` |
| PK | `id` (autoincrement Int, 단 문자열 ID 예외) | `id Int @id @default(autoincrement())` |
| FK | `{참조모델}Id` | `stationId`, `userId` |
| 생성 시각 | `createdAt` | `DateTime @default(now())` |
| 수정 시각 | `updatedAt` | `DateTime @updatedAt` |
| 소프트 삭제 | `isActive Boolean @default(true)` | - |
| Enum | PascalCase | `TransactionStatus`, `UserRole` |

---

## 7. 마이그레이션 관리

```bash
# 새 마이그레이션 생성
npx prisma migrate dev --name add_fault_log_table

# 프로덕션 적용
npx prisma migrate deploy

# 스키마 확인
npx prisma db pull

# Prisma Client 재생성
npx prisma generate
```

---

## 8. 체크리스트

- [ ] `prisma/schema.prisma` 전체 모델 작성 완료
- [ ] `npx prisma migrate dev` 초기 마이그레이션 성공
- [ ] 인덱스 전략 검토 완료
- [ ] MeterValue 파티셔닝 계획 수립
- [ ] 시드 데이터(CsmsVariable) 적용 완료
- [ ] Prisma Client 생성 확인
- [ ] 환경별 DATABASE_URL 설정 완료 (dev/staging/prod)
- [ ] [v1.1 신규] `charger_provisioning` 테이블 마이그레이션 완료
- [ ] [v1.1 신규] `station_id_sequence` 테이블 생성 + 시드(lastNumber=1000000) 완료
- [ ] [v1.1 신규] `charging_station.password_hash`, `manufacturer` 필드 추가 마이그레이션 완료
- [ ] [v1.1 신규] `charging_site.charge_operator_name`, `manager_name`, `manager_phone` 필드 추가 완료
- [ ] [v1.1 신규] `partner_profile.margin_rate`, `settlement_day`, `bank_name`, `bank_account`, `bank_account_holder` 필드 추가 완료
- [ ] [v1.1 신규] `settlement` 테이블 마이그레이션 완료
- [ ] [v1.1 신규] `ocpp_message.action` 인덱스 추가 완료
- [ ] [v1.1 신규] `fault_log.resolved_at` 인덱스 추가 완료
- [ ] [v1.2 신규] `transaction` 결제 필드(payment_status, payment_method, pg_transaction_id, unit_price_krw, margin_rate) 추가 완료
- [ ] [v1.2 신규] `refund_log` 테이블 마이그레이션 완료
- [ ] [v1.2 신규] `charger_config` 테이블 마이그레이션 완료
- [ ] [v1.2 신규] `partner_profile.settlement_schedule`, `settlement_day_of_week` 추가 완료
- [ ] [v1.2 신규] `fault_log.reported_at` 인덱스 추가 완료

---

## v1.2 신규 모델 요약

### PaymentStatus enum
`pending | paid | failed | cancelled | refunded`

### RefundLog 모델
| 필드 | 타입 | 설명 |
|------|------|------|
| id | Int @id | PK |
| transactionId | Int @unique | Transaction FK (1:1) |
| userId | Int? | User FK |
| paidAmount | Decimal | 실제 결제 금액 |
| chargedAmount | Decimal | 충전된 전기 요금 (kWh × 단가) |
| refundAmount | Decimal | 환불 금액 (paidAmount - chargedAmount) |
| status | RefundStatus | pending/processing/completed/failed/cancelled |
| note | String? | 처리 메모 |
| requestedAt | DateTime | 요청 시각 |
| processedAt | DateTime? | 처리 완료 시각 |

### ChargerConfig 모델
| 필드 | 타입 | 설명 |
|------|------|------|
| id | Int @id | PK |
| stationId | String | ChargingStation FK |
| key | String | 설정 키 (OCPP ChangeConfiguration 키명) |
| value | String | 설정 값 |
| status | ChargerConfigStatus | normal/error |
| errorDesc | String? | 오류 설명 |
| createdAt | DateTime | 등록일 |
| updatedAt | DateTime | 수정일 |
**@@unique([stationId, key])** — 동일 충전기에 동일 키 중복 불가

### SettlementSchedule enum
`daily | weekly | monthly` — PartnerProfile에 추가됨
