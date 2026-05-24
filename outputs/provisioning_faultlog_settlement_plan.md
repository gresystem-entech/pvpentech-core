# 프로비저닝 / 장애로그 / 정산 구현 계획

- **작성일**: 2026-04-15
- **버전**: v1.0
- **참조 설계 문서**:
  - `documents/design_ref/provisioning_fault_reparing.md`
  - `documents/design_ref/transaction_details.md`
  - `documents/design_guide/04_database_schema.md`
  - `documents/design_guide/12_charger_provisioning.md`
- **구현 범위**: 프로비저닝 관리 보완, 장애 로그 필터 보완, 정산 관리 보완, 충전이력 결제 정보 추가

---

## 목차

1. [현황 요약](#현황-요약)
2. [Phase 1: DB 스키마 변경 + 마이그레이션](#phase-1-db-스키마-변경--마이그레이션)
3. [Phase 2: 백엔드 API 보완](#phase-2-백엔드-api-보완)
4. [Phase 3: 프론트엔드 UI 보완](#phase-3-프론트엔드-ui-보완)
5. [Phase 4: 설계 가이드 문서 업데이트](#phase-4-설계-가이드-문서-업데이트)
6. [작업 의존성 및 수행 순서](#작업-의존성-및-수행-순서)
7. [전체 태스크 요약표](#전체-태스크-요약표)

---

## 현황 요약

### 프로비저닝 관리 현황

| 항목 | 상태 | 비고 |
|------|------|------|
| ChargerProvisioning CRUD (등록/목록/상세/취소/삭제) | 완료 | `provision.service.ts`, `provisioning.routes.ts` |
| keyword 검색 (serialNumber, stationId) | 누락 | `ProvisionService.list()`에 where 조건 없음 |
| PUT 수정 API | 누락 | routes에 PUT 없음 |
| CSV 예제 다운로드 | 누락 | |
| CSV 일괄등록 | 누락 | |
| ChargerConfig 모델 | 누락 | schema에 없음 |
| ChargerConfig CRUD API | 누락 | |
| 프론트엔드 목록 페이지 | 오동작 | `/provisioning/configs` 호출 → 404 |

### 장애 로그 현황

| 항목 | 상태 | 비고 |
|------|------|------|
| GET / (다중 필터) | 완료 | `faultLogs.routes.ts` |
| POST / (장애 등록) | 완료 | |
| PATCH /:id/status | 완료 | |
| keyword 검색 (description, faultType) | 누락 | |
| 날짜 필터 필드명 정합성 | 불일치 | 라우트에서 `reportedAt` 필드 사용, schema에는 `reportedAt`과 `createdAt` 모두 존재하므로 의도 확인 필요 |
| 프론트엔드 keyword 입력 필드 | 누락 | 필터바에 없음 |

### 정산 관리 현황

| 항목 | 상태 | 비고 |
|------|------|------|
| GET / (전체 목록) | 부분 완료 | 날짜 범위·partnerId 필터 없음 |
| GET /by-partner | 부분 완료 | 페이지네이션 없음, startDate/endDate 필터 없음 |
| GET /by-site | 부분 완료 | 페이지네이션 없음 |
| POST /manual (수동 정산) | 누락 | |
| PATCH /:id/status | 누락 | |
| 프론트엔드 날짜 범위 필터 (전체탭) | 누락 | |
| 프론트엔드 수동정산 버튼+모달 | 누락 | |
| 프론트엔드 페이지네이션 (byPartner, bySite) | 누락 | |

### 충전이력 결제 정보 현황

| 항목 | 상태 | 비고 |
|------|------|------|
| Transaction 기본 필드 (status, costKrw 등) | 완료 | |
| paymentStatus, paymentMethod, pgTransactionId | 누락 | schema에 없음 |
| unitPriceKrw, marginRate | 누락 | schema에 없음 |
| GET /sessions 응답에 위 필드 포함 | 누락 | |
| 프론트엔드 충전이력 테이블 컬럼 | 누락 | 결제상태, 충전단가, 리베이트율 컬럼 없음 |

---

## Phase 1: DB 스키마 변경 + 마이그레이션

**목적**: 이후 API·UI 구현의 기반이 되는 DB 스키마를 먼저 확정하고 마이그레이션을 완료한다.

### 수정 파일

- `prisma/schema.prisma` — 모델 추가 및 필드 추가
- `prisma/migrations/` — Prisma 자동 생성 마이그레이션 파일
- `documents/design_guide/04_database_schema.md` — 스키마 문서 업데이트 (Phase 4에서 통합)

---

### 태스크 DB-1: ChargerConfig 모델 신규 추가

**작업 설명**

`prisma/schema.prisma`에 `ChargerConfig` 모델을 추가한다. 이 모델은 ChargerProvisioning과 1:N 관계를 가지며, 설치된 충전기의 per-station 설정 key-value 쌍을 저장한다. 설계 문서의 (충전기id, key, value, 등록상태, 에러설명) 스펙을 충족한다.

**추가할 Prisma 모델 정의**

```prisma
model ChargerConfig {
  id          Int                @id @default(autoincrement())
  stationId   String             @db.VarChar(50)   // ChargerProvisioning.stationId 참조
  key         String             @db.VarChar(100)
  value       String?            @db.Text
  status      ChargerConfigStatus @default(normal)
  errorDesc   String?            @db.VarChar(255)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  // ChargerProvisioning의 stationId를 통해 연결
  // 직접 FK를 걸지 않고 stationId 문자열로 관리 (프로비저닝 전 설정도 허용)
  @@index([stationId])
  @@index([stationId, key])
  @@map("charger_config")
}

enum ChargerConfigStatus {
  normal
  error
}
```

**수정 파일**: `prisma/schema.prisma`

**마이그레이션 명령어**

```bash
npx prisma migrate dev --name add_charger_config
```

**예상 난이도**: 하

---

### 태스크 DB-2: Transaction 모델에 결제 관련 필드 추가

**작업 설명**

`prisma/schema.prisma`의 `Transaction` 모델에 결제처리 상태 및 결제 상세 정보 필드를 추가한다. 설계 문서(`transaction_details.md`)의 결제저장정보(결제수단, 결제시간, 결제금액, 거래번호) 및 충전이력 결제처리 결과(pending/paid/failed/cancelled/refunded)를 반영한다.

**추가할 필드 (Transaction 모델 내)**

```prisma
  paymentStatus    PaymentStatus?              // 결제처리 상태
  paymentMethod    String?        @db.VarChar(50)  // 카드, 앱결제 등
  pgTransactionId  String?        @db.VarChar(200) // PG사 거래번호
  unitPriceKrw     Int?                            // 충전 시점 단가 (원/kWh)
  marginRate       Decimal?       @db.Decimal(5, 2) // 충전 시점 리베이트율 스냅샷 (%)
```

**추가할 Enum**

```prisma
enum PaymentStatus {
  pending     // 결제 대기
  paid        // 결제 완료
  failed      // 결제 실패
  cancelled   // 취소됨
  refunded    // 환불됨
}
```

**수정 파일**: `prisma/schema.prisma`

**마이그레이션 명령어**

```bash
npx prisma migrate dev --name add_transaction_payment_fields
```

**주의사항**: 기존 Transaction 레코드의 `paymentStatus`는 `null`로 유지된다. 기존 데이터 마이그레이션(backfill)은 별도 스크립트가 필요할 경우 운영팀과 협의한다.

**예상 난이도**: 하

---

### 태스크 DB-3: FaultLog 날짜 필터 필드명 정합성 확인 및 인덱스 추가

**작업 설명**

현재 `faultLogs.routes.ts`에서 날짜 필터로 `reportedAt` 필드를 사용하고 있다. 실제 `prisma/schema.prisma`를 확인하면 `FaultLog` 모델에는 `reportedAt DateTime @default(now())`와 `createdAt DateTime @default(now())` 양쪽이 모두 존재한다. `reportedAt`은 "장애 발생 보고 일시"로 사용자가 등록한 시점을 의미하므로, 날짜 필터는 `reportedAt` 기준이 맞다.

현재 schema에는 `reportedAt`에 대한 인덱스가 없으므로 날짜 범위 검색 성능을 위해 인덱스를 추가한다.

**추가할 인덱스 (FaultLog 모델 내)**

```prisma
  @@index([reportedAt])  // 날짜 범위 필터 성능 개선
```

**수정 파일**: `prisma/schema.prisma`

**마이그레이션 명령어**

```bash
npx prisma migrate dev --name add_fault_log_reported_at_index
```

**예상 난이도**: 하

---

## Phase 2: 백엔드 API 보완

**목적**: 설계 문서에 정의된 검색·수정·일괄처리·정산 기능을 API 레벨에서 완전히 구현한다.

### 수정 파일 목록 (Phase 2 전체)

| 파일 | 변경 유형 |
|------|---------|
| `src/services/provision.service.ts` | 수정 (keyword 검색, update 메서드 추가) |
| `src/routes/portal/cs/provisioning.routes.ts` | 수정 (PUT, sample-csv, bulk-upload 라우트 추가) |
| `src/services/chargerConfig.service.ts` | 신규 생성 |
| `src/routes/portal/cs/chargerConfigs.routes.ts` | 신규 생성 |
| `src/routes/index.ts` | 수정 (chargerConfigs 라우트 등록) |
| `src/routes/portal/cs/faultLogs.routes.ts` | 수정 (keyword 필터, orderBy 보완) |
| `src/routes/portal/cs/settlements.routes.ts` | 수정 (날짜 필터, 페이지네이션, manual, status 라우트 추가) |
| `src/services/settlement.service.ts` | 신규 생성 (또는 기존 repository 활용) |
| `src/services/session.service.ts` | 수정 (listAll 응답에 신규 필드 포함) |

---

### 태스크 P-1: GET /provisioning — keyword 검색 추가

**작업 설명**

`ProvisionService.list()` 메서드에 `keyword` 파라미터를 추가한다. keyword는 `serialNumber`와 `stationId` 필드에 대해 대소문자 무관 부분 일치(`contains` + `mode: 'insensitive'`) 검색을 수행한다. Prisma `OR` 조건을 활용한다.

`provisioning.routes.ts`의 GET `/` 핸들러가 `keyword` 쿼리 파라미터를 `controller.list`로 전달하도록 수정하고, `ProvisionController.list()`가 이를 service에 전달한다.

**수정 내용 요약**

- `ProvisionService.list()` 파라미터에 `keyword?: string` 추가
- `keyword`가 있을 때 Prisma `where.OR = [ { serialNumber: { contains: keyword, mode: 'insensitive' } }, { stationId: { contains: keyword, mode: 'insensitive' } } ]` 적용
- `ProvisionController.list()`에서 `req.query.keyword` 전달

**수정 파일**

- `src/services/provision.service.ts`
- `src/controllers/provision.controller.ts` (list 메서드)

**예상 난이도**: 하

---

### 태스크 P-2: PUT /provisioning/:id — 프로비저닝 항목 수정

**작업 설명**

`provisioning.routes.ts`에 `PUT /:id` 라우트를 추가한다. 수정 가능한 필드는 `serialNumber`, `rejectReason`이다. `stationId`는 프로비저닝 완료(status=provisioned) 이후에는 변경 불가 처리한다.

`ProvisionService`에 `update(id, data)` 메서드를 추가한다. `status=provisioned` 상태에서 `serialNumber` 변경 시도 시 `ConflictError`를 발생시킨다.

**수정 내용 요약**

- `ProvisionService.update(id: number, data: { serialNumber?: string; rejectReason?: string })` 메서드 신규 추가
- `provisioning.routes.ts`에 `router.put('/:id', controller.update)` 추가
- `ProvisionController`에 `update` 메서드 추가 (Zod validation 포함)

**수정 파일**

- `src/services/provision.service.ts`
- `src/controllers/provision.controller.ts`
- `src/routes/portal/cs/provisioning.routes.ts`

**예상 난이도**: 하

---

### 태스크 P-3: GET /provisioning/sample-csv — 예제 CSV 다운로드

**작업 설명**

`provisioning.routes.ts`에 `GET /sample-csv` 라우트를 추가한다. 이 엔드포인트는 일괄등록에 사용할 CSV 예제 파일을 반환한다. Content-Type을 `text/csv`로 설정하고 `Content-Disposition: attachment; filename="provisioning_sample.csv"` 헤더를 포함한다.

CSV 포맷: `serialNumber` 헤더 1개 컬럼, 예시 데이터 3행.

```
serialNumber
SN-VENDOR-2026-001
SN-VENDOR-2026-002
SN-VENDOR-2026-003
```

**주의사항**: `GET /sample-csv`는 `GET /:id` 보다 먼저 선언해야 라우트 충돌이 발생하지 않는다.

**수정 파일**

- `src/routes/portal/cs/provisioning.routes.ts`

**예상 난이도**: 하

---

### 태스크 P-4: POST /provisioning/bulk-upload — CSV 일괄등록

**작업 설명**

`provisioning.routes.ts`에 `POST /bulk-upload` 라우트를 추가한다. `multipart/form-data`로 CSV 파일을 수신하고, 각 행의 `serialNumber`를 파싱하여 `ProvisionService.register()`를 통해 등록한다.

구현 세부 사항:
- `multer` 미들웨어를 사용하여 파일 수신 (`memoryStorage` 사용, 서버에 저장하지 않음)
- `csv-parse` 또는 직접 `\n` 분리 파싱으로 serialNumber 목록 추출
- 각 행을 순차 등록하되, 중복(`ConflictError`)은 결과에 skip으로 기록하고 계속 진행
- 응답: `{ success: true, data: { total, registered, skipped, errors: [{ serialNumber, reason }] } }`

**의존성 설치 필요**

```bash
npm install multer
npm install --save-dev @types/multer
```

`csv-parse`는 이미 설치되어 있을 가능성이 있으므로 확인 후 미설치 시 추가.

**수정 파일**

- `src/routes/portal/cs/provisioning.routes.ts`
- `src/services/provision.service.ts` (bulkRegister 메서드 추가 또는 기존 register 재사용)
- `package.json` (multer 의존성)

**예상 난이도**: 중

---

### 태스크 P-5 & P-6: ChargerConfig 모델 CRUD API 구현

**작업 설명**

태스크 DB-1에서 추가한 `ChargerConfig` 모델에 대해 CRUD API를 구현한다.

**신규 생성 파일: `src/services/chargerConfig.service.ts`**

메서드 목록:

| 메서드 | 설명 |
|--------|------|
| `list(params)` | stationId 필터, 페이지네이션 지원 |
| `create(data)` | key-value 등록, stationId + key 조합 중복 체크 |
| `update(id, data)` | value, status, errorDesc 수정 |
| `delete(id)` | 단건 삭제 |

**신규 생성 파일: `src/routes/portal/cs/chargerConfigs.routes.ts`**

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/` | 목록 (stationId, page, limit 쿼리) |
| POST | `/` | 신규 등록 |
| PUT | `/:id` | 수정 |
| DELETE | `/:id` | 삭제 |

**`src/routes/index.ts` 수정**

```typescript
// 기존 provisioning 라우트 등록 아래에 추가
import chargerConfigsRouter from './portal/cs/chargerConfigs.routes';
// ...
router.use('/api/portal/cs/provisioning/configs', csMiddleware, chargerConfigsRouter);
```

**수정/신규 파일**

- `src/services/chargerConfig.service.ts` (신규)
- `src/routes/portal/cs/chargerConfigs.routes.ts` (신규)
- `src/routes/index.ts` (chargerConfigs 라우트 등록)

**예상 난이도**: 중

---

### 태스크 F-1: GET /faultlogs — keyword 필터 추가

**작업 설명**

`faultLogs.routes.ts`의 GET `/` 핸들러에 `keyword` 쿼리 파라미터를 처리하는 로직을 추가한다. keyword가 있을 때 Prisma `OR` 조건으로 `description`과 `faultType`(Enum을 문자열 cast)에 대해 부분 일치 검색을 수행한다.

`description`은 `@db.Text` 타입이므로 `contains` + `mode: 'insensitive'` 적용 가능하다.
`faultType`은 PostgreSQL Enum이므로 직접 `contains`가 불가하다. `faultType`에 대한 keyword 검색은 Enum 값을 열거하여 keyword를 포함하는 Enum 값만 `in` 조건으로 필터링하거나, `description`에만 keyword를 적용하는 방식으로 처리한다. 설계 문서에서는 "로그중에 포함된 단어(부분 검색 적용)"로 정의되어 있으므로 `description` 부분 검색을 우선 구현하고, `faultType` 문자열 매칭은 Enum 값 열거 방식으로 보완한다.

**수정 내용 요약**

- `req.query.keyword` 처리 로직 추가
- `where` 조건에 `OR: [ { description: { contains: keyword, mode: 'insensitive' } }, { faultType: { in: matchingFaultTypes } } ]` 추가
- `matchingFaultTypes`: `FaultType` Enum 값 배열 중 keyword가 포함되는 값 필터링 (`['ConnectorFault','CommunicationError','PowerFault','Other'].filter(ft => ft.toLowerCase().includes(keyword.toLowerCase()))`)

**수정 파일**

- `src/routes/portal/cs/faultLogs.routes.ts`

**예상 난이도**: 하

---

### 태스크 F-2: FaultLog 날짜 필터 필드명 검증 및 정리

**작업 설명**

현재 `faultLogs.routes.ts`에서 날짜 필터를 `reportedAt` 필드로 적용 중이다. `prisma/schema.prisma`에는 `FaultLog.reportedAt`이 실제로 존재하므로 필드명은 정확하다. 다만 `orderBy: { reportedAt: 'desc' }` 정렬도 동일하게 `reportedAt` 기준으로 적용되어 있어 일관성 확인이 필요하다.

이 태스크에서 수행할 작업:
1. `faultLogs.routes.ts` 코드에서 `reportedAt`과 `createdAt` 사용이 혼재하지 않는지 전체 검토
2. `FaultLogService.list()`의 `orderBy`도 `reportedAt` 기준으로 통일
3. `FaultLogService`(비포털용)는 `createdAt` 기준으로 정렬 중이므로, 포털 라우트의 직접 쿼리와 서비스의 동작 기준을 명시적으로 주석으로 구분

**수정 파일**

- `src/routes/portal/cs/faultLogs.routes.ts` (주석 및 orderBy 명시)
- `src/services/faultLog.service.ts` (orderBy 기준 명시)

**예상 난이도**: 하

---

### 태스크 S-1: GET /settlements — 날짜 범위 및 partnerId 필터 추가

**작업 설명**

`settlements.routes.ts`의 전체 목록 GET `/` 핸들러에 `startDate`, `endDate`, `partnerId` 쿼리 파라미터 처리를 추가한다. `startDate`/`endDate`는 `periodStart` 필드 기준으로 필터링한다(설계 문서: "정산기간이란, 정산일이 포함되는 기간을 말한다" → `periodStart` 기준).

**추가할 필터 로직**

```typescript
if (req.query.startDate || req.query.endDate) {
  where['periodStart'] = {
    ...(req.query.startDate && { gte: new Date(req.query.startDate as string) }),
    ...(req.query.endDate && { lte: new Date(req.query.endDate as string) }),
  };
}
if (req.query.partnerId) where['partnerId'] = Number(req.query.partnerId);
if (req.query.status) where['status'] = req.query.status;
```

**수정 파일**

- `src/routes/portal/cs/settlements.routes.ts`

**예상 난이도**: 하

---

### 태스크 S-2: GET /settlements/by-partner 및 /by-site — 페이지네이션 추가

**작업 설명**

`settlements.routes.ts`의 `by-partner` 및 `by-site` 핸들러에 페이지네이션을 추가한다. 기존에는 `findMany`로 전체 조회 후 반환하는 방식이었으나, `page`, `limit` 쿼리 파라미터를 받아 `skip/take`를 적용하고 `count`로 총 건수를 계산하여 반환한다.

`by-partner`: `partnerId` + `startDate`/`endDate` (periodStart 기준) 복합 필터 유지하면서 페이지네이션 추가.
`by-site`: `siteId` + `startDate`/`endDate` 필터 유지하면서 페이지네이션 추가.

응답 형식을 기존 `{ items, total }` 에서 `{ items, total, page, limit, totalPages }`로 통일한다.

**수정 파일**

- `src/routes/portal/cs/settlements.routes.ts`

**예상 난이도**: 하

---

### 태스크 S-3: POST /settlements/manual — 수동 정산 API

**작업 설명**

수동 정산 기능을 구현한다. 설계 문서(`transaction_details.md`)에서 "파트너의 미정산된 충전이력에 대하여 현시점을 기준으로 정산처리"로 정의한다.

**Request Body**

```typescript
{
  partnerId: number;       // 정산할 파트너 ID
  periodStart: string;     // ISO 8601 날짜 (정산 기간 시작)
  periodEnd: string;       // ISO 8601 날짜 (정산 기간 종료)
  periodType?: string;     // 'monthly' | 'weekly' | 'daily' | 'instant', 기본값: 'instant'
  note?: string;           // 메모
}
```

**비즈니스 로직**

1. `partnerId`로 `PartnerProfile` 조회 → `marginRate` 스냅샷 가져옴
2. 파트너 소속 충전소 목록 조회 (`ChargingSite.partnerId = partnerId`)
3. 해당 충전소들의 `Transaction` 조회: `status = 'Stopped'` AND `timeStart >= periodStart` AND `timeStart <= periodEnd`
4. 조회된 Transaction들의 `costKrw` 합산 → `totalAmount`, `(meterEnd - meterStart)` 합산 → `totalKwh`
5. `settlementAmount = totalAmount * marginRate / 100`
6. `Settlement` 레코드 생성 (siteId = null, 파트너 전체 합산)

**Prisma 트랜잭션 사용 권장**: 집계와 Settlement 생성을 단일 트랜잭션으로 묶는다.

**에러 케이스**

- `partnerId` 미존재 → 404
- `periodStart > periodEnd` → 400
- 해당 기간 Stopped 트랜잭션 없음 → 200 with empty data or 400 (정책 결정 필요, 기본값: 빈 정산 허용)

**신규 서비스 파일**: `src/services/settlement.service.ts`에 `createManual(data)` 메서드 구현

**수정/신규 파일**

- `src/services/settlement.service.ts` (신규 또는 기존 repository 활용)
- `src/routes/portal/cs/settlements.routes.ts`

**예상 난이도**: 상

---

### 태스크 S-4: PATCH /settlements/:id/status — 정산 상태 변경

**작업 설명**

`settlements.routes.ts`에 `PATCH /:id/status` 라우트를 추가한다. `pending` → `completed` 또는 `pending` → `cancelled` 전환을 허용한다.

- `completed`로 변경 시: `settledAt = new Date()`, `settledBy = req.user.username`
- `cancelled`로 변경 시: 이미 `completed`인 경우 변경 거부 (`ConflictError`)
- 존재하지 않는 ID → 404

**Request Body**

```typescript
{
  status: 'completed' | 'cancelled';
  note?: string;
}
```

**수정 파일**

- `src/routes/portal/cs/settlements.routes.ts`

**예상 난이도**: 하

---

### 태스크 T-2: GET /api/portal/cs/sessions 응답에 결제 필드 포함

**작업 설명**

태스크 DB-2에서 추가된 `paymentStatus`, `paymentMethod`, `pgTransactionId`, `unitPriceKrw`, `marginRate` 필드를 `session.service.ts`의 `listAll()` 응답에 포함시킨다.

현재 `select`나 `include` 없이 `prisma.transaction.findMany()`를 사용 중이므로 Prisma가 모든 필드를 자동 반환한다. 따라서 schema 마이그레이션(DB-2) 완료 후에는 별도 서비스 코드 수정 없이 신규 필드가 자동으로 응답에 포함된다.

다만 다음 사항을 확인하고 명시적으로 처리한다:
- `listAll()` 메서드의 TypeScript 반환 타입에 새 필드가 포함되도록 Prisma Client 재생성 (`npx prisma generate`) 후 확인
- `listByPartner()`, `listByUser()`도 동일하게 자동 포함 여부 확인

**수정 파일**

- `src/services/session.service.ts` (타입 확인 및 주석 추가)

**예상 난이도**: 하 (schema 마이그레이션 후 주로 타입 확인 작업)

---

## Phase 3: 프론트엔드 UI 보완

**목적**: 백엔드 API 보완에 맞춰 CS 포털 SPA(`public/portal/cs/index.html`)의 프로비저닝, 장애로그, 정산, 충전이력 화면을 실제 API와 연동하여 동작하도록 재작성한다.

**전제**: 이 프로젝트의 포털은 단일 SPA 파일(`public/portal/cs/index.html`) 기반으로 구현되어 있다. 모든 UI 변경은 이 파일 내의 해당 함수를 수정하는 방식으로 진행한다.

### 수정 파일 목록 (Phase 3 전체)

| 파일 | 변경 내용 |
|------|---------|
| `public/portal/cs/index.html` | 프로비저닝, 장애로그, 정산, 충전이력 UI 섹션 수정 |

---

### 태스크 P-7: 프로비저닝 목록 페이지 전면 재작성

**작업 설명**

현재 `loadProvisioning()` 함수가 존재하지 않는 `/api/portal/cs/provisioning/configs` 엔드포인트를 호출하여 항상 빈 화면을 표시하는 문제를 수정한다.

**재작성 내용**

1. **올바른 API 호출**: `/api/portal/cs/provisioning` 엔드포인트로 변경
2. **검색 필터바 추가**: keyword 입력 필드, status 셀렉트 (전체/registered/provisioned/revoked), 검색 버튼
3. **테이블 컬럼**: ID, 시리얼번호, 충전기ID, 상태, 등록자, 등록일, 프로비저닝 완료일, 액션(수정/무효화/삭제)
4. **페이지네이션**: `buildPagination()` 헬퍼 활용
5. **CSV 버튼 2개**: "예제 다운로드" (`/api/portal/cs/provisioning/sample-csv`), "일괄등록" (파일 선택 → `/api/portal/cs/provisioning/bulk-upload`)
6. **수정 모달**: serialNumber 수정 폼
7. **ChargerConfig 탭 링크**: 목록 각 행에서 해당 충전기의 설정 보기 링크 제공 (태스크 P-8과 연계)
8. **i18n**: 새로 추가되는 UI 문자열에 대해 ko/en/vi 3개 언어 번역 추가

**수정 파일**

- `public/portal/cs/index.html` — `loadProvisioning()` 함수 전체 재작성, i18n 번역 키 추가

**예상 난이도**: 중

---

### 태스크 P-8: ChargerConfig 탭 추가 (per-station 설정 key-value 관리)

**작업 설명**

프로비저닝 목록 화면 내에 "충전기 설정" 탭을 추가하거나, 기존 탭바에 "설정 프로파일" 탭을 추가하여 `ChargerConfig` 데이터를 관리하는 UI를 구현한다.

**구현 내용**

1. 탭 구조: "프로비저닝 목록" | "설정 프로파일" 2개 탭
2. 설정 프로파일 탭: stationId 필터 드롭다운, 테이블(ID, 충전기ID, 키, 값, 상태, 에러설명, 등록일, 액션)
3. 신규 등록 버튼 + 모달 (stationId, key, value, status 입력)
4. 수정/삭제 액션
5. API 연동: `/api/portal/cs/provisioning/configs` (GET/POST/PUT/DELETE)
6. **i18n**: 신규 문자열 ko/en/vi 번역 추가

**수정 파일**

- `public/portal/cs/index.html` — `loadProvisioning()` 내 탭 로직 추가

**예상 난이도**: 중

---

### 태스크 F-3: 장애로그 필터바에 keyword 입력 추가

**작업 설명**

`loadFaultLogs()` 함수의 필터바에 keyword 입력 필드를 추가한다.

**수정 내용**

1. 필터바에 `<input class="filter-input" type="text" id="fault_keyword" placeholder="설명/장애유형 검색">` 추가
2. `searchFaultLogs()` 또는 검색 버튼 핸들러에서 `keyword` 값을 filters에 포함
3. `loadFaultLogs()` 함수 내 API 호출 시 `params.set('keyword', filters.keyword)` 추가
4. **i18n**: keyword 레이블 ko/en/vi 번역 추가 (`'filter.keyword': '키워드'` 등)

**수정 파일**

- `public/portal/cs/index.html` — `loadFaultLogs()` 함수 수정, i18n 번역 키 추가

**예상 난이도**: 하

---

### 태스크 S-5: 정산 전체탭에 날짜 범위 필터 추가

**작업 설명**

`loadSettlements('all')` 분기에서 날짜 범위 필터 UI가 없는 문제를 수정한다. `byPartner` 탭에는 이미 날짜 필터가 있으나 `all` 탭에는 없다.

**수정 내용**

1. `all` 탭 선택 시에도 파트너 셀렉트 + 시작일/종료일 필터바 표시
2. `doLoadSettlements('all')` 함수에서 `startDate`, `endDate`, `partnerId`를 쿼리에 포함하여 `/api/portal/cs/settlements` 호출
3. 기존 전체 탭의 `params` 빌드 로직 통일 (`startDate`/`endDate` → `periodStart` 기준임을 주석으로 명시)

**수정 파일**

- `public/portal/cs/index.html` — `loadSettlements()`, `doLoadSettlements()` 함수 수정

**예상 난이도**: 하

---

### 태스크 S-6: 정산 파트너별 탭에 "수동 정산" 버튼 + 모달 추가

**작업 설명**

`byPartner` 탭에서 특정 파트너가 선택된 상태에서 "수동 정산" 버튼을 클릭하면 모달을 열어 정산 기간을 입력하고 `POST /api/portal/cs/settlements/manual`을 호출한다.

**구현 내용**

1. `byPartner` 탭 필터바에 "수동 정산" 버튼 추가 (파트너 미선택 시 비활성화)
2. 모달 폼: 정산 기간 시작일, 정산 기간 종료일, 정산 유형(monthly/weekly/daily/instant), 메모
3. 제출 시 `POST /api/portal/cs/settlements/manual` 호출
4. 성공 시 목록 새로고침 + 성공 토스트 표시
5. **i18n**: "수동 정산" 관련 신규 문자열 ko/en/vi 번역 추가

**수정 파일**

- `public/portal/cs/index.html` — `loadSettlements()` 함수 수정, 모달 함수 추가, i18n 번역 키 추가

**예상 난이도**: 중

---

### 태스크 S-7: 정산 모든 탭에 페이지네이션 추가

**작업 설명**

`doLoadSettlements()` 함수에서 `byPartner` 및 `bySite` 탭의 API 응답이 현재 페이지네이션 없이 전체 목록을 반환하고 있다. 태스크 S-2에서 API가 페이지네이션을 지원하도록 수정되면, 프론트엔드에서도 페이지네이션을 활성화한다.

**수정 내용**

1. `doLoadSettlements()` 함수에 현재 `page` 상태 관리 추가 (`pageState.settlementPage` 등)
2. API 호출 시 `page`, `limit` 파라미터 추가
3. 응답의 `totalPages` 기준으로 `buildPagination()` 헬퍼를 사용하여 페이지 버튼 렌더링
4. 전체(`all`) 탭도 동일하게 페이지네이션 적용
5. 탭 전환 시 페이지를 1로 초기화

**수정 파일**

- `public/portal/cs/index.html` — `doLoadSettlements()` 함수 수정

**예상 난이도**: 하

---

### 태스크 T-3: 충전이력 테이블에 결제상태·충전단가·리베이트율 컬럼 추가

**작업 설명**

`loadTransactions()` 함수에서 렌더링하는 충전이력 테이블에 새 컬럼 3개를 추가한다.

**수정 내용**

1. 테이블 헤더에 `결제상태`, `충전단가(원/kWh)`, `리베이트율(%)` 컬럼 추가
2. 테이블 행 렌더링에 아래 값 추가:
   - `결제상태`: `r.paymentStatus`가 있으면 `paymentStatusBadge(r.paymentStatus)` 함수로 badge 렌더링, 없으면 `-`
   - `충전단가`: `r.unitPriceKrw != null ? r.unitPriceKrw.toLocaleString() : '-'`
   - `리베이트율`: `r.marginRate != null ? Number(r.marginRate).toFixed(2) + '%' : '-'`
3. `paymentStatusBadge()` 헬퍼 함수 추가: pending(회색)/paid(녹색)/failed(빨강)/cancelled(주황)/refunded(파랑) 배지
4. **i18n**: 신규 컬럼 헤더 ko/en/vi 번역 추가

**수정 파일**

- `public/portal/cs/index.html` — `loadTransactions()` 함수 수정, `paymentStatusBadge()` 헬퍼 추가, i18n 번역 키 추가

**예상 난이도**: 하

---

## Phase 4: 설계 가이드 문서 업데이트

**목적**: Phase 1~3에서 변경·추가된 스키마, API, UI 내용을 설계 가이드 문서에 반영하여 최신 상태로 유지한다.

### 수정 파일 목록

| 파일 경로 | 업데이트 내용 |
|----------|-------------|
| `documents/design_guide/04_database_schema.md` | ChargerConfig 모델, Transaction 결제 필드, FaultLog reportedAt 인덱스 추가 내용 반영 |
| `documents/design_guide/12_charger_provisioning.md` | keyword 검색, PUT 수정, CSV 일괄등록, ChargerConfig API 엔드포인트 목록 추가 |
| `documents/design_guide/05_rest_api_design.md` | 정산 manual API, status 변경 API, ChargerConfig CRUD API 엔드포인트 스펙 추가 |

---

### 태스크 DOC-1: DB 스키마 문서 업데이트

**작업 설명**

`documents/design_guide/04_database_schema.md`의 Prisma 스키마 전체 정의 섹션에 다음 내용을 추가한다:

- `ChargerConfig` 모델 전체 정의 추가 (DB-1)
- `Transaction` 모델에 추가된 필드 및 `PaymentStatus` enum 추가 (DB-2)
- `FaultLog` 모델의 `@@index([reportedAt])` 추가 (DB-3)
- 버전 v1.2로 업데이트, 업데이트 내용 헤더에 기재
- 체크리스트 섹션에 신규 항목 추가

**수정 파일**: `documents/design_guide/04_database_schema.md`

**예상 난이도**: 하

---

### 태스크 DOC-2: 프로비저닝 설계 가이드 업데이트

**작업 설명**

`documents/design_guide/12_charger_provisioning.md`의 CS 포탈 API 목록 섹션(섹션 10)에 다음 내용을 추가한다:

- `GET /api/portal/cs/provisioning?keyword=&status=&page=&limit=` — keyword/status 검색 파라미터 명세
- `PUT /api/portal/cs/provisioning/:id` — 수정 API 명세 (Request/Response 예시 포함)
- `GET /api/portal/cs/provisioning/sample-csv` — 예제 CSV 다운로드
- `POST /api/portal/cs/provisioning/bulk-upload` — CSV 일괄등록 (Request/Response 예시 포함)
- `GET|POST|PUT|DELETE /api/portal/cs/provisioning/configs` — ChargerConfig CRUD API 명세

**수정 파일**: `documents/design_guide/12_charger_provisioning.md`

**예상 난이도**: 하

---

### 태스크 DOC-3: REST API 설계 가이드 업데이트

**작업 설명**

`documents/design_guide/05_rest_api_design.md`에 다음 신규/변경 API 엔드포인트 명세를 추가한다:

- 정산 섹션: `POST /api/portal/cs/settlements/manual`, `PATCH /api/portal/cs/settlements/:id/status`
- 정산 섹션: `GET /settlements` startDate/endDate/partnerId 필터 파라미터 추가 명세
- 충전이력 섹션: `GET /api/portal/cs/sessions` 응답 스키마에 결제 필드 추가
- 장애로그 섹션: `GET /api/portal/cs/faultlogs` keyword 필터 파라미터 추가 명세

**수정 파일**: `documents/design_guide/05_rest_api_design.md`

**예상 난이도**: 하

---

## 작업 의존성 및 수행 순서

```
Phase 1 (DB)
├── DB-1 ChargerConfig 모델 추가      ──► P-5/P-6 ChargerConfig CRUD API
├── DB-2 Transaction 결제 필드 추가   ──► T-2 sessions 응답 필드 포함
│                                          ──► T-3 프론트 충전이력 컬럼
└── DB-3 FaultLog 인덱스              ──► (독립, F-1/F-2에 대한 선행조건 없음)

Phase 2 (Backend) — Phase 1 완료 후 시작 가능 (DB-1, DB-2 완료 필요 항목만)
├── P-1 keyword 검색 (독립)
├── P-2 PUT 수정 (독립)
├── P-3 sample-csv (독립)
├── P-4 bulk-upload (독립)
├── P-5/P-6 ChargerConfig API       ← DB-1 필요
├── F-1 keyword 필터 (독립)
├── F-2 날짜 필터명 정리 (독립)
├── S-1 날짜/파트너 필터 (독립)
├── S-2 페이지네이션 (독립)
├── S-3 수동정산 API (독립)
├── S-4 status 변경 API (독립)
└── T-2 sessions 필드              ← DB-2 필요

Phase 3 (Frontend) — Phase 2 완료 후 진행 권장
├── P-7 프로비저닝 목록 재작성       ← P-1, P-2, P-3, P-4 완료 후
├── P-8 ChargerConfig 탭            ← P-5/P-6 완료 후
├── F-3 keyword 필터 UI             ← F-1 완료 후
├── S-5 전체탭 날짜 필터            ← S-1 완료 후
├── S-6 수동정산 버튼+모달          ← S-3 완료 후
├── S-7 페이지네이션                ← S-2 완료 후
└── T-3 충전이력 컬럼              ← T-2 완료 후

Phase 4 (Docs) — Phase 2 완료 후 병행 가능
├── DOC-1 DB 스키마 문서
├── DOC-2 프로비저닝 가이드
└── DOC-3 REST API 가이드
```

---

## 전체 태스크 요약표

| 태스크 ID | 구분 | 작업 설명 | 수정 파일 | 난이도 |
|-----------|------|----------|----------|--------|
| DB-1 | Phase 1 | ChargerConfig 모델 신규 추가 | `prisma/schema.prisma` | 하 |
| DB-2 | Phase 1 | Transaction 결제 필드 추가 (paymentStatus 등) | `prisma/schema.prisma` | 하 |
| DB-3 | Phase 1 | FaultLog reportedAt 인덱스 추가 | `prisma/schema.prisma` | 하 |
| P-1 | Phase 2 | GET /provisioning keyword 검색 | `provision.service.ts`, `provision.controller.ts` | 하 |
| P-2 | Phase 2 | PUT /provisioning/:id 수정 API | `provision.service.ts`, `provision.controller.ts`, `provisioning.routes.ts` | 하 |
| P-3 | Phase 2 | GET /provisioning/sample-csv | `provisioning.routes.ts` | 하 |
| P-4 | Phase 2 | POST /provisioning/bulk-upload CSV 일괄등록 | `provisioning.routes.ts`, `provision.service.ts`, `package.json` | 중 |
| P-5/P-6 | Phase 2 | ChargerConfig CRUD API 신규 구현 | `chargerConfig.service.ts`(신규), `chargerConfigs.routes.ts`(신규), `routes/index.ts` | 중 |
| F-1 | Phase 2 | GET /faultlogs keyword 필터 | `faultLogs.routes.ts` | 하 |
| F-2 | Phase 2 | FaultLog 날짜 필터 필드명 정리 | `faultLogs.routes.ts`, `faultLog.service.ts` | 하 |
| S-1 | Phase 2 | GET /settlements 날짜·파트너 필터 | `settlements.routes.ts` | 하 |
| S-2 | Phase 2 | GET /by-partner, /by-site 페이지네이션 | `settlements.routes.ts` | 하 |
| S-3 | Phase 2 | POST /settlements/manual 수동정산 | `settlement.service.ts`(신규), `settlements.routes.ts` | 상 |
| S-4 | Phase 2 | PATCH /settlements/:id/status 상태 변경 | `settlements.routes.ts` | 하 |
| T-2 | Phase 2 | GET /sessions 응답에 결제 필드 포함 | `session.service.ts` | 하 |
| P-7 | Phase 3 | 프로비저닝 목록 페이지 전면 재작성 | `public/portal/cs/index.html` | 중 |
| P-8 | Phase 3 | ChargerConfig 탭 추가 | `public/portal/cs/index.html` | 중 |
| F-3 | Phase 3 | 장애로그 keyword 입력 필드 추가 | `public/portal/cs/index.html` | 하 |
| S-5 | Phase 3 | 정산 전체탭 날짜 범위 필터 | `public/portal/cs/index.html` | 하 |
| S-6 | Phase 3 | 수동 정산 버튼+모달 | `public/portal/cs/index.html` | 중 |
| S-7 | Phase 3 | 정산 모든 탭 페이지네이션 | `public/portal/cs/index.html` | 하 |
| T-3 | Phase 3 | 충전이력 결제상태·단가·리베이트율 컬럼 | `public/portal/cs/index.html` | 하 |
| DOC-1 | Phase 4 | DB 스키마 문서 업데이트 | `documents/design_guide/04_database_schema.md` | 하 |
| DOC-2 | Phase 4 | 프로비저닝 설계 가이드 업데이트 | `documents/design_guide/12_charger_provisioning.md` | 하 |
| DOC-3 | Phase 4 | REST API 설계 가이드 업데이트 | `documents/design_guide/05_rest_api_design.md` | 하 |

**총 태스크 수**: 24개
**예상 난이도 분포**: 상 1개, 중 6개, 하 17개

---

## 부록: 설계 결정 사항 및 모호성 해소

### 1. ChargerConfig의 stationId 참조 방식

설계 문서에서 ChargerConfig는 ChargerProvisioning의 "충전기id"를 참조한다. 코드 레벨에서는 `ChargerProvisioning.stationId` (프로비저닝 완료 시 발급되는 "EN"+7자리)를 외래키로 사용한다. 단, 프로비저닝 전 설정도 허용할 필요가 있을 경우를 대비하여 직접 FK 제약 대신 인덱스만 적용한다.

### 2. FaultLog 날짜 필터 기준 필드

`faultLogs.routes.ts`가 이미 `reportedAt` 필드를 사용 중이고 `prisma/schema.prisma`에 `reportedAt DateTime @default(now())`가 실제로 존재한다. 따라서 현재 구현이 올바르다. `createdAt`과 `reportedAt`이 별도로 존재하는 이유는 `reportedAt`이 "장애 보고 일시"(사용자 지정 가능성)이고 `createdAt`은 "레코드 생성 일시"로 구분된 것이다. 날짜 검색 기준은 `reportedAt`을 유지한다.

### 3. 수동 정산 대상 트랜잭션 조건

설계 문서에서 "결제가 완료되지 않은 것들"이라고 정의하나, DB-2 이전에는 `paymentStatus` 필드가 없다. Phase 1(DB-2) 완료 전에 S-3을 먼저 구현할 경우 `Transaction.status = 'Stopped'` 조건만으로 집계한다. DB-2 완료 후에는 `paymentStatus IS NULL OR paymentStatus != 'paid'` 조건을 추가 적용하도록 S-3 구현 시 조건부 로직을 작성한다.

### 4. CSV 파싱 라이브러리 선택

`bulk-upload` 구현 시 외부 라이브러리 없이 간단히 `Buffer.toString().split('\n')`으로도 처리 가능하다. 다만 큰따옴표 포함 필드, BOM 처리 등 엣지케이스를 위해 `csv-parse` 사용을 권장한다. 프로젝트에 이미 설치되어 있지 않으면 `npm install csv-parse`를 추가한다.

### 5. i18n 번역 범위

CLAUDE.md에 따라 모든 신규 UI 문자열은 ko/en/vi 3개 언어로 번역을 추가해야 한다. Phase 3의 각 태스크에서 신규 추가되는 UI 레이블은 `public/portal/cs/index.html` 내 인라인 i18n 딕셔너리(`translations.ko`, `translations.en`, `translations.vi`)에 동시에 추가한다.

---

## payment_settlement.md 추가 요구사항 반영 (v1.1 업데이트)

> **업데이트일**: 2026-04-15  
> **반영 문서**: `documents/design_ref/payment_settlement.md`

payment_settlement.md 분석 결과 아래 3개 영역의 추가 구현이 필요하다. 기존 24개 태스크에 10개가 추가되어 **총 34개 태스크**로 확장된다.

---

### 추가 구현 영역 요약

| 영역 | 핵심 내용 | 신규 태스크 |
|------|----------|------------|
| 결제금액 계산 로직 보완 | `chargeGoalProcessor`의 amount 계산을 실제 단가 기반으로 수정 | PAY-1, PAY-2 |
| 환불 처리 | RefundLog 모델 추가, 환불 API, 환불 이력 조회 | REF-1 ~ REF-5 |
| 정산 배치 처리 | 일/주/월 단위 자동 정산 스케줄러 (BullMQ 기반) | BATCH-1 ~ BATCH-3 |

---

### 신규 Phase 1 추가: DB 스키마 (결제/환불)

#### 태스크 DB-4: RefundLog 모델 추가

**작업 설명**

`payment_settlement.md`에 정의된 환불 처리 요구사항을 충족하기 위해 `RefundLog` 모델을 신규 추가한다.

환불금액 계산 공식: **환불금액 = 사용자 결제금액 - 실제 충전금액**  
(`실제 충전금액 = (meterEnd - meterStart) / 1000 × unitPriceKrw`)

**추가할 Prisma 모델 정의**

```prisma
model RefundLog {
  id              Int           @id @default(autoincrement())
  transactionId   Int           @unique     // Transaction 1:1
  userId          Int?
  paidAmount      Int           // 사용자 선결제 금액 (원)
  chargedAmount   Int           // 실제 충전금액 (원) = kWh × unitPrice
  refundAmount    Int           // 환불금액 = paidAmount - chargedAmount
  status          RefundStatus  @default(pending)
  requestedAt     DateTime      @default(now())
  processedAt     DateTime?     // 환불 완료 시각
  pgRefundId      String?       @db.VarChar(200)  // PG사 환불 거래번호
  note            String?       @db.VarChar(500)

  transaction     Transaction   @relation(fields: [transactionId], references: [id])
  user            User?         @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([status])
  @@index([requestedAt])
  @@map("refund_log")
}

enum RefundStatus {
  pending      // 환불 대기
  processing   // 환불 진행 중
  completed    // 환불 완료
  failed       // 환불 실패
  cancelled    // 환불 취소
}
```

**수정 파일**: `prisma/schema.prisma`  
**예상 난이도**: 하

---

#### 태스크 DB-5: PartnerProfile에 정산 배치 설정 필드 추가

**작업 설명**

파트너별 자동 정산 배치 설정 정보를 저장하기 위한 필드를 `PartnerProfile`에 추가한다.

```prisma
// PartnerProfile 모델에 추가
settlementSchedule  SettlementSchedule  @default(monthly)  // 일/주/월 단위
settlementDayOfWeek Int?   @db.SmallInt  // 주 단위 정산 시 요일 (0=일, 1=월 ... 6=토)
// 기존 settlementDay (1~28) 는 월 단위 정산일로 유지
```

```prisma
enum SettlementSchedule {
  daily
  weekly
  monthly
}
```

**수정 파일**: `prisma/schema.prisma`  
**예상 난이도**: 하

---

### 신규 Phase 2 추가: 결제 계산 로직 보완

#### 태스크 PAY-1: chargeGoalProcessor amount 계산 실제 단가 적용

**작업 설명**

현재 `src/jobs/processors/chargeGoal.processor.ts`에서 amount 목표 도달 여부 판단 시 `kwh * 250`으로 하드코딩된 단가를 사용한다. 이를 실제 충전소의 `unitPriceKrw`로 변경한다.

**현재 코드 (문제)**

```typescript
if (goalType === 'amount' && status.kwh * 250 >= goalValue) shouldStop = true;
```

**수정 내용**

1. `chargeGoalProcessor`가 job 데이터에 `unitPriceKrw`를 받도록 인터페이스 확장
2. 충전 시작(StartTransaction) 시 해당 충전소의 `site.unitPriceKrw`를 job data에 포함
3. `amount` 타입 목표 계산: `status.kwh * unitPriceKrw >= goalValue`

**수정 파일**

- `src/jobs/processors/chargeGoal.processor.ts`
- `src/ocpp/handlers/startTransaction.handler.ts` (job enqueue 시 unitPriceKrw 포함)

**예상 난이도**: 중

---

#### 태스크 PAY-2: 충전 종료 시 선결제금액 vs 실제 충전금액 비교 → 환불 자동 생성

**작업 설명**

`payment_settlement.md`에서 "사용자가 충전 비용을 선결제했으므로 충전 종료 시 충전량과 비교해서 금액이 남으면 환불처리해야 한다"로 정의한다.

충전 종료(StopTransaction) 처리 시, `goalType = 'amount'`인 경우 선결제 금액 대비 실제 충전 금액을 비교하여 차액이 있으면 `RefundLog`를 자동 생성한다.

**비즈니스 로직**

1. `stopTransaction.handler.ts` 또는 `charge.service.ts`의 충전 종료 로직에 훅 추가
2. `transaction.goalType === 'amount'`인 경우:
   - 선결제 금액 = `transaction.goalValue` (원)
   - 실제 충전금액 = `(meterEnd - meterStart) / 1000 × unitPriceKrw`
   - 환불금액 = 선결제금액 - 실제 충전금액 (양수인 경우에만 처리)
3. 환불금액 > 0이면 `RefundLog` 레코드 생성 (status = 'pending')
4. 실제 PG사 환불 호출은 별도 서비스로 추상화 (현 단계에서는 RefundLog 생성까지만 구현, PG 연동은 추후)

**수정 파일**

- `src/ocpp/handlers/stopTransaction.handler.ts`
- `src/services/refund.service.ts` (신규)

**예상 난이도**: 중

---

### 신규 Phase 2 추가: 환불 처리 API

#### 태스크 REF-1: GET /api/portal/cs/refunds — 환불 이력 조회 API

**작업 설명**

`payment_settlement.md`에서 정의한 환불 이력 조회 화면을 위한 API를 구현한다.

**조회 정보**: 파트너, 충전소, 충전기, 사용자, 충전일시, 결제금액, 충전금액, 환불금액, 환불처리상태

**쿼리 파라미터**

| 파라미터 | 설명 |
|---------|------|
| `partnerId` | 파트너 필터 |
| `siteId` | 충전소 필터 |
| `stationId` | 충전기 필터 |
| `status` | 환불 상태 필터 |
| `startDate`, `endDate` | 환불 요청일 범위 |
| `page`, `limit` | 페이지네이션 |

**수정/신규 파일**

- `src/routes/portal/cs/refunds.routes.ts` (신규)
- `src/services/refund.service.ts` (신규, PAY-2와 통합)
- `src/routes/index.ts` (라우트 등록)

**예상 난이도**: 중

---

#### 태스크 REF-2: PATCH /api/portal/cs/refunds/:id/status — 환불 상태 변경

**작업 설명**

CS 관리자가 환불 상태를 수동으로 변경할 수 있는 API를 구현한다. `pending` → `processing`, `processing` → `completed` 또는 `failed` 전환을 허용한다. `completed` 전환 시 `processedAt` 자동 기록.

**수정 파일**

- `src/routes/portal/cs/refunds.routes.ts`

**예상 난이도**: 하

---

#### 태스크 REF-3: S-3 수동 정산 로직 보완 — 환불금액 차감 반영

**작업 설명**

기존 S-3(수동 정산) 태스크의 정산금액 계산 공식을 `payment_settlement.md` 기준으로 수정한다.

**수정된 공식**

```
settlementAmount = (totalAmount - totalRefundAmount) × marginRate / 100
```

- `totalRefundAmount`: 해당 기간, 해당 파트너 소속 충전기의 `RefundLog.refundAmount` (status = 'completed') 합산
- DB-4(RefundLog 모델) 완료 후 적용

**수정 파일**

- `src/services/settlement.service.ts` (S-3 구현 시 반영)

**예상 난이도**: 중 (S-3 구현과 연계)

---

### 신규 Phase 2 추가: 정산 배치 처리

#### 태스크 BATCH-1: 정산 배치 Queue 및 Processor 추가

**작업 설명**

BullMQ 기반으로 정산 배치 큐(`settlementQueue`)와 프로세서를 추가한다. 기존 `chargeGoalQueue`, `cleanupQueue`와 동일한 패턴으로 구현한다.

**구현 내용**

1. `src/jobs/queues.ts`에 `settlementQueue` 추가
2. `src/jobs/processors/settlement.processor.ts` 신규 생성:
   - 각 파트너의 `settlementSchedule` 설정을 읽어 대상 파트너 목록 조회
   - 해당 파트너의 정산 기간 계산 (일/주/월 기준)
   - `SettlementService.createManual()` 호출하여 Settlement 레코드 생성
   - 이미 해당 기간의 Settlement가 존재하면 skip
3. `src/jobs/index.ts`에 processor 등록

**수정/신규 파일**

- `src/jobs/queues.ts`
- `src/jobs/processors/settlement.processor.ts` (신규)
- `src/jobs/index.ts`

**예상 난이도**: 상

---

#### 태스크 BATCH-2: 정산 배치 스케줄러 등록

**작업 설명**

`daily.scheduler.ts`에 정산 배치 스케줄을 추가한다.

- **일 단위**: 매일 새벽 1시 실행 (전날의 미정산 transaction 처리)
- **주 단위**: 매주 월요일 새벽 1시 실행 (전주 미정산 transaction 처리)
- **월 단위**: 매월 1일 새벽 1시 실행 (전월 미정산 transaction 처리)

각 스케줄은 `settlementQueue`에 job을 enqueue하며, processor가 대상 파트너 필터링 및 기간 계산을 수행한다.

```typescript
// daily settlement: 01:00 AM daily
const DAILY_SETTLEMENT_CRON = '0 1 * * *';
// weekly settlement: 01:00 AM every Monday
const WEEKLY_SETTLEMENT_CRON = '0 1 * * 1';
// monthly settlement: 01:00 AM on the 1st of each month
const MONTHLY_SETTLEMENT_CRON = '0 1 1 * *';
```

**수정 파일**

- `src/jobs/schedulers/daily.scheduler.ts`
- `src/jobs/queues.ts`

**예상 난이도**: 중

---

#### 태스크 BATCH-3: 파트너 정산 설정 UI (정산 스케줄 설정)

**작업 설명**

CS 포털의 파트너 상세 모달에 정산 스케줄 설정 UI를 추가한다.

**추가 항목**

- 정산 주기: 일/주/월 선택
- 주 단위인 경우: 정산 요일 선택 (월~일)
- 월 단위인 경우: 기존 `settlementDay` 필드 사용 (1~28일, 말일 자동 처리 로직 포함)

**수정 파일**

- `public/portal/cs/index.html` — 파트너 상세 모달(`openPartnerDetail()`) 수정
- `src/routes/portal/cs/partners.routes.ts` — PUT /:id에 `settlementSchedule`, `settlementDayOfWeek` 수정 허용

**예상 난이도**: 하

---

### 신규 Phase 3 추가: 환불 이력 UI

#### 태스크 REF-4: 환불 이력 조회 화면 추가

**작업 설명**

CS 포털에 환불 이력 전용 메뉴를 추가한다. `payment_settlement.md`의 환불이력 출력 정보(파트너/충전소/충전기/사용자/충전일시/결제금액/충전금액/환불금액/환불처리상태)를 표시한다.

**구현 내용**

1. 좌측 네비게이션에 "환불 이력" 메뉴 항목 추가 (정산 섹션 하위)
2. `loadRefunds()` 함수 신규 구현:
   - 필터바: 파트너, 충전소, 충전기, 환불 상태, 날짜 범위
   - 테이블: 충전일시, 파트너, 충전소, 충전기ID, 사용자, 결제금액, 충전금액, 환불금액, 상태, 상태변경 액션
3. 상태 변경: 각 행에 상태 변경 드롭다운 버튼 추가 → `PATCH /api/portal/cs/refunds/:id/status` 호출
4. **i18n**: 신규 메뉴 및 UI 문자열 ko/en/vi 번역 추가

**수정 파일**

- `public/portal/cs/index.html` — nav 메뉴, `loadRefunds()` 함수, i18n 번역 키

**예상 난이도**: 중

---

#### 태스크 REF-5: 파트너 포털 환불 이력 조회 추가

**작업 설명**

파트너 포털(`public/portal/partner/index.html`)에서도 자신의 충전기 관련 환불 이력을 조회할 수 있도록 UI를 추가한다.

**수정 파일**

- `public/portal/partner/index.html`
- `src/routes/portal/partner/` — 환불 조회 API (파트너 범위 제한)

**예상 난이도**: 중

---

### 업데이트된 작업 의존성

```
[기존 의존성 유지]

DB-4 RefundLog 모델    ──► PAY-2 충전 종료 시 환불 자동 생성
                       ──► REF-1 환불 이력 조회 API
                       ──► REF-2 환불 상태 변경 API
                       ──► REF-3 S-3 정산 공식 보완
                       ──► REF-4 환불 이력 UI
                       ──► REF-5 파트너 포털 환불 이력

DB-5 PartnerProfile 스케줄 필드 ──► BATCH-1 정산 배치 Processor
                                 ──► BATCH-3 파트너 정산 설정 UI

PAY-1 단가 기반 계산   ──► PAY-2 환불 자동 생성 (unitPriceKrw 필요)

BATCH-1 Processor      ──► BATCH-2 스케줄러 등록
S-3 수동정산 API       ──► BATCH-1 (동일 로직 재사용)
                       ──► REF-3 (환불 차감 반영)
```

---

### 업데이트된 전체 태스크 요약표 (v1.1)

| 태스크 ID | Phase | 작업 설명 | 수정 파일 | 난이도 |
|-----------|-------|----------|----------|--------|
| DB-1 | 1 | ChargerConfig 모델 추가 | `schema.prisma` | 하 |
| DB-2 | 1 | Transaction 결제 필드 추가 | `schema.prisma` | 하 |
| DB-3 | 1 | FaultLog reportedAt 인덱스 | `schema.prisma` | 하 |
| **DB-4** | **1** | **RefundLog 모델 추가** | `schema.prisma` | **하** |
| **DB-5** | **1** | **PartnerProfile 정산 스케줄 필드** | `schema.prisma` | **하** |
| P-1 | 2 | GET /provisioning keyword 검색 | `provision.service.ts` | 하 |
| P-2 | 2 | PUT /provisioning/:id 수정 | `provision.service.ts`, `provisioning.routes.ts` | 하 |
| P-3 | 2 | GET /provisioning/sample-csv | `provisioning.routes.ts` | 하 |
| P-4 | 2 | POST /provisioning/bulk-upload | `provisioning.routes.ts` | 중 |
| P-5/P-6 | 2 | ChargerConfig CRUD API | `chargerConfig.service.ts`(신규), `chargerConfigs.routes.ts`(신규) | 중 |
| F-1 | 2 | GET /faultlogs keyword 필터 | `faultLogs.routes.ts` | 하 |
| F-2 | 2 | FaultLog 날짜 필터 필드명 정리 | `faultLogs.routes.ts` | 하 |
| S-1 | 2 | GET /settlements 날짜·파트너 필터 | `settlements.routes.ts` | 하 |
| S-2 | 2 | GET /by-partner, /by-site 페이지네이션 | `settlements.routes.ts` | 하 |
| S-3 | 2 | POST /settlements/manual 수동 정산 | `settlement.service.ts`(신규), `settlements.routes.ts` | 상 |
| S-4 | 2 | PATCH /settlements/:id/status | `settlements.routes.ts` | 하 |
| T-2 | 2 | GET /sessions 응답 결제 필드 포함 | `session.service.ts` | 하 |
| **PAY-1** | **2** | **chargeGoalProcessor 단가 기반 계산** | `chargeGoal.processor.ts`, `startTransaction.handler.ts` | **중** |
| **PAY-2** | **2** | **충전 종료 시 환불 자동 생성** | `stopTransaction.handler.ts`, `refund.service.ts`(신규) | **중** |
| **REF-1** | **2** | **GET /refunds 환불 이력 조회 API** | `refunds.routes.ts`(신규), `refund.service.ts` | **중** |
| **REF-2** | **2** | **PATCH /refunds/:id/status** | `refunds.routes.ts` | **하** |
| **REF-3** | **2** | **수동 정산 환불금액 차감 반영** | `settlement.service.ts` | **중** |
| **BATCH-1** | **2** | **정산 배치 Queue + Processor** | `queues.ts`, `settlement.processor.ts`(신규) | **상** |
| **BATCH-2** | **2** | **정산 배치 스케줄러 등록** | `daily.scheduler.ts`, `queues.ts` | **중** |
| P-7 | 3 | 프로비저닝 목록 페이지 전면 재작성 | `index.html` | 중 |
| P-8 | 3 | ChargerConfig 탭 추가 | `index.html` | 중 |
| F-3 | 3 | 장애로그 keyword 입력 필드 | `index.html` | 하 |
| S-5 | 3 | 정산 전체탭 날짜 범위 필터 | `index.html` | 하 |
| S-6 | 3 | 수동 정산 버튼+모달 | `index.html` | 중 |
| S-7 | 3 | 정산 모든 탭 페이지네이션 | `index.html` | 하 |
| T-3 | 3 | 충전이력 결제상태·단가·리베이트율 컬럼 | `index.html` | 하 |
| **REF-4** | **3** | **환불 이력 조회 화면 (CS 포털)** | `index.html` | **중** |
| **REF-5** | **3** | **파트너 포털 환불 이력 조회** | `partner/index.html` | **중** |
| **BATCH-3** | **3** | **파트너 정산 스케줄 설정 UI** | `index.html`, `partners.routes.ts` | **하** |
| DOC-1 | 4 | DB 스키마 문서 업데이트 | `04_database_schema.md` | 하 |
| DOC-2 | 4 | 프로비저닝 설계 가이드 업데이트 | `12_charger_provisioning.md` | 하 |
| DOC-3 | 4 | REST API 설계 가이드 업데이트 | `05_rest_api_design.md` | 하 |

**총 태스크**: 34개  
**예상 난이도**: 상 2개, 중 13개, 하 19개
