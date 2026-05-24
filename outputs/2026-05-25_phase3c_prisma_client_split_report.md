# Phase 3-C 보고서: Prisma Client Type-level 분리

**작업일**: 2026-05-25
**범위**: `prisma` 단일 클라이언트 → `prismaCore` / `prismaPortal` 분리

---

## 1. 접근 방식 선택: 접근 A (Type-level 분리)

**선택 이유**:
- 사용자 결정(D-2): 같은 PostgreSQL 인스턴스 사용 → 실제 런타임 분리 불필요
- Outbox 패턴(Phase 2-D) 사용 → 클라이언트 간 cross-schema 트랜잭션 불필요
- 단순성: 구현 코드 최소화, 런타임 connection pool 비용 없음
- 향후 DB 인스턴스 완전 분리 시 `database.ts` 한 곳만 수정하면 접근 B 전환 가능

**접근 B 미선택 이유**: connection pool 2배, cross-schema 트랜잭션 복잡도 증가

---

## 2. prismaCore / prismaPortal 노출 모델 표

### prismaCore (core schema 모델 19개)

| 모델 | Prisma 프로퍼티 |
|------|----------------|
| ChargingStation | `chargingStation` |
| Connector | `connector` |
| IdToken | `idToken` |
| Transaction | `transaction` |
| MeterValue | `meterValue` |
| DeviceVariable | `deviceVariable` |
| OcppMessage | `ocppMessage` |
| OcppCommandResult | `ocppCommandResult` |
| DiagnosticsRequest | `diagnosticsRequest` |
| Firmware | `firmware` |
| FirmwareCampaign | `firmwareCampaign` |
| FirmwareCampaignProgress | `firmwareCampaignProgress` |
| FaultLog | `faultLog` |
| Manufacturer | `manufacturer` |
| ChargerProvisioning | `chargerProvisioning` |
| StationIdSequence | `stationIdSequence` |
| OfflineLog | `offlineLog` |
| ChargerConfig | `chargerConfig` |
| OutboxEvent | `outboxEvent` |

유틸리티: `$transaction`, `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe`, `$disconnect`

### prismaPortal (portal schema 모델 13개)

| 모델 | Prisma 프로퍼티 |
|------|----------------|
| ChargingSite | `chargingSite` |
| SitePriceHistory | `sitePriceHistory` |
| User | `user` |
| PartnerProfile | `partnerProfile` |
| PaymentCard | `paymentCard` |
| Settlement | `settlement` |
| RefundLog | `refundLog` |
| RefundAttempt | `refundAttempt` |
| CsmsVariable | `csmsVariable` |
| ConsumedEvent | `consumedEvent` |
| ChargeSessionProjection | `chargeSessionProjection` |
| PgConfig | `pgConfig` |
| PaymentOrder | `paymentOrder` |

유틸리티: `$transaction`, `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe`, `$disconnect`

---

## 3. 변경된 파일 카운트

### packages/shared
- **수정**: `packages/shared/src/config/database.ts` — `prismaCore`, `prismaPortal`, `PrismaCoreClient`, `PrismaPortalClient` export 추가. 기존 `prisma` deprecated 유지.
- `packages/shared/src/index.ts` — `export * from './config/database'` 기존 코드로 자동 re-export (수정 불필요)

### packages/core (37개 파일)
- `import { prisma }` → `import { prismaCore as prisma }` 전환: **37개**
- 추가로 cross-schema(portal 모델) 접근으로 `prismaLegacy` dual import 추가: **3개**
  - `packages/core/src/services/station.service.ts` (chargingSite)
  - `packages/core/src/routes/portal/cs/faultLogs.routes.ts` (chargingSite)
  - `packages/core/src/routes/portal/cs/stations.routes.ts` (chargingSite)

### packages/portal (37개 파일)
- portal-only 모델만 사용 → `prismaPortal as prisma` 전환: **13개**
  - auth.service.ts, pgConfig.service.ts, settlements.routes.ts (cs+partner),
    sites.routes.ts (partner), stats.routes.ts (partner), paymentCards.routes.ts,
    settlement.repository.ts, auth.middleware.ts, userLanguage.middleware.ts,
    refundDispatch.processor.ts, settlement.processor.ts, idempotency.ts
- cross-schema 접근 있음 → deprecated `prisma` 유지 + TODO 주석: **24개**

### apps
- `apps/core-server/src/index.ts` — `$disconnect` → `prismaCore.$disconnect()`로 명시
- `apps/portal-server/src/index.ts` — `$disconnect` → `prismaPortal.$disconnect()`로 명시

---

## 4. 잔존 Cross-package 모델 접근 위치 (Phase 3-D 작업 대상)

### 4-A. Core 패키지에서 Portal 모델 직접 접근 (3개 파일)

| 파일 | 접근 모델 | 처리 방안 |
|------|----------|----------|
| `packages/core/src/services/station.service.ts` | `chargingSite` (존재 검증) | 검증 로직 제거 또는 Portal API 호출 |
| `packages/core/src/routes/portal/cs/faultLogs.routes.ts` | `chargingSite` (partnerId 필터) | Portal API 내부 호출 또는 라우트 이전 |
| `packages/core/src/routes/portal/cs/stations.routes.ts` | `chargingSite` (사이트명 조회) | Portal API 내부 호출 |

### 4-B. Portal 패키지에서 Core 모델 직접 접근 (24개 파일)

아래 파일들이 `ChargingStation`, `Transaction`, `IdToken`, `Connector` 등 core 모델을 직접 조회.
Phase 3-D에서 `CoreApiClient` 호출 또는 `ChargeSessionProjection` 뷰 사용으로 전환 예정.

| 파일 | 주요 접근 Core 모델 |
|------|-------------------|
| `repositories/transaction.repository.ts` | Transaction (16건) |
| `routes/portal/cs/idTokens.routes.ts` | IdToken (14건) |
| `services/stats.service.ts` | ChargingStation, Transaction (12건) |
| `repositories/idToken.repository.ts` | IdToken (12건) |
| `services/session.service.ts` | ChargingStation, Transaction, IdToken (10건) |
| `services/payment.service.ts` | Transaction, ChargingStation (9건) |
| `services/charge.service.ts` | Transaction, ChargingStation (8건) |
| `routes/portal/cs/sites.routes.ts` | ChargingStation (5건) |
| `routes/portal/cs/partners.routes.ts` | ChargingStation (5건) |
| `services/refund.service.ts` | Transaction (4건) |
| `routes/portal/customer/rfidCards.routes.ts` | IdToken (4건) |
| `repositories/partner.repository.ts` | ChargingStation (4건) |
| `routes/portal/customer/dashboard.routes.ts` | Transaction (3건) |
| `services/user.service.ts` | IdToken (2건) |
| `services/site.service.ts` | ChargingStation (2건) |
| `repositories/site.repository.ts` | ChargingStation (2건) |
| `services/settlement.service.ts` | Transaction (1건) |
| `services/partner.service.ts` | ChargingStation (1건) |
| `routes/portal/partner/stations.routes.ts` | ChargingStation (1건) |
| `routes/portal/cs/ops.routes.ts` | ChargingStation (1건) |
| `jobs/paymentTimeout.job.ts` | Transaction (1건) |
| `jobs/processors/postChargeBilling.processor.ts` | Transaction (1건) |
| `middlewares/manufacturerAuth.middleware.ts` | Manufacturer (1건) |
| `repositories/user.repository.ts` | IdToken (1건) |

---

## 5. 컴파일 검증 결과

```
npx prisma generate  → 성공 (Prisma Client v5.22.0)
npm run build        → 성공 (TypeScript 오류 0건)
```

빌드 과정에서 발견된 타입 오류:
- Core 3개 파일의 `chargingSite` 접근 → `prismaLegacy` dual import로 해결

---

## 6. $transaction 사용 패턴

### Core 패키지
- `prismaCore.$transaction(async (tx) => { ... })` 패턴 사용
- `tx` 내부에서 `writeOutbox(tx, ...)` 호출 — `OutboxEvent`는 core schema이므로 정상
- 예: `stopTransaction.handler.ts`, `startTransaction.handler.ts`

### Portal 패키지
- `prismaPortal.$transaction(async (tx) => { ... })` 패턴 사용
- `tx` 내부에서 portal 전용 모델만 접근
- `$transaction` 콜백의 `tx` 매개변수는 `Prisma.TransactionClient` 타입 — 모든 모델 접근 가능하나 컨벤션으로 portal 모델만 사용 권장

### 공통 주의사항
- `prismaCore.$transaction` 안에서 portal 모델 접근 시 런타임은 동작하나 타입 에러 미발생
- 접근 A 특성상 컴파일 타임 보호는 `$transaction` 콜백 매개변수(`tx`)에는 미적용
- Phase 3-D 완료 후 `$transaction` 콜백 내부 cross-schema 사용도 제거될 예정

---

## 7. 향후 DB 인스턴스 완전 분리 시 마이그레이션 경로 (접근 B 전환)

접근 A → B 전환은 `packages/shared/src/config/database.ts` 한 곳만 수정:

```typescript
// 접근 B: PrismaClient 인스턴스 2개
const coreClient = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_CORE } } });
const portalClient = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_PORTAL } } });

export const prismaCore = {
  chargingStation: coreClient.chargingStation,
  // ... core 모델
  $transaction: coreClient.$transaction.bind(coreClient),
  $disconnect: coreClient.$disconnect.bind(coreClient),
};

export const prismaPortal = {
  chargingSite: portalClient.chargingSite,
  // ... portal 모델
  $transaction: portalClient.$transaction.bind(portalClient),
  $disconnect: portalClient.$disconnect.bind(portalClient),
};
```

전환 전제조건:
1. Phase 3-D 완료 (cross-schema 직접 접근 제거)
2. `DATABASE_URL_CORE`, `DATABASE_URL_PORTAL` 환경변수 분리
3. apps 진입점의 `$connect`/`$disconnect` 각각 호출로 업데이트

---

## 8. 타입 export 요약

`packages/shared/src/config/database.ts`에서 추가 export:

| Symbol | 용도 |
|--------|------|
| `prismaCore` | Core 패키지 전용 DB 접근 객체 |
| `prismaPortal` | Portal 패키지 전용 DB 접근 객체 |
| `PrismaCoreClient` | `typeof prismaCore` — 함수 인자 타입 선언용 |
| `PrismaPortalClient` | `typeof prismaPortal` — 함수 인자 타입 선언용 |
| `prisma` | (deprecated) 기존 단일 클라이언트 — Phase 3-D 완료 후 제거 |
