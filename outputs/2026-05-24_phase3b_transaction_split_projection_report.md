# Phase 3-B: Transaction 모델 정리 + ChargeSessionProjection 신규 생성 보고서

**작성일**: 2026-05-25  
**작업자**: Code Implementer Agent  
**참조 설계**: `outputs/2026-05-21_system_split_design_review.md` 섹션 5-1, 5-2  
**D-1 결정**: Transaction.paymentStatus, settlementId → Portal ChargeSessionProjection으로 이전  
**옵션 C 채택**: settlementSchedule, settlementDay, settlementDayOfWeek는 Core Transaction에 유지 (Outbox payload 무결성)

---

## 1. 변경된 모델 표

### 1-1. Transaction 모델 (core schema) — Before/After

| 필드 | Before | After | 비고 |
|------|--------|-------|------|
| `paymentStatus` | `PaymentStatus?` | **제거** | Portal ChargeSessionProjection으로 이전 |
| `settlementId` | `Int?` + FK → settlement | **제거** | Portal ChargeSessionProjection으로 이전 |
| `settlement` relation | `Settlement? @relation(...)` | **제거** | FK 제거에 따른 relation 제거 |
| `refundLog` relation | `RefundLog?` | **제거** | RefundLog.transaction → Logical FK로 전환 |
| `settlementSchedule` | `SettlementSchedule?` | **유지** | 옵션 C: Outbox payload 무결성 |
| `settlementDay` | `Int?` | **유지** | 옵션 C: Outbox payload 무결성 |
| `settlementDayOfWeek` | `Int?` | **유지** | 옵션 C: Outbox payload 무결성 |
| `paymentMethod` | `String?` | 유지 | Core가 직접 처리하는 결제 방법 |
| `pgTransactionId` | `String?` | 유지 | PG 거래번호 |
| `@@index([paymentStatus, settlementId])` | 있음 | **제거** | 해당 필드 제거에 따라 |
| `@@index([settlementId])` | 있음 | **제거** | 해당 필드 제거에 따라 |

### 1-2. PaymentStatus enum

| Before | After |
|--------|-------|
| `@@schema("core")` | **`@@schema("portal")`** |

ChargeSessionProjection이 portal schema에 위치하므로 함께 이전.

### 1-3. ChargingStation 모델 (core schema)

| 변경 | 내용 |
|------|------|
| `site ChargingSite? @relation(...)` | **제거** (siteId Int? 값은 유지 — Logical FK) |

### 1-4. RefundLog 모델 (portal schema)

| 변경 | 내용 |
|------|------|
| `transaction Transaction @relation(...)` | **제거** (transactionId Int @unique 값 유지 — Logical FK) |

### 1-5. Settlement 모델 (portal schema)

| 변경 | 내용 |
|------|------|
| `transactions Transaction[]` | **제거** (Transaction.settlementId 필드 제거에 따라) |
| `sessions ChargeSessionProjection[]` | **신규 추가** (역방향 relation) |

### 1-6. ChargingSite / PartnerProfile 모델 (portal schema)

| 모델 | 변경 |
|------|------|
| `ChargingSite` | `chargingStations ChargingStation[]` **제거** + `sessions ChargeSessionProjection[]` **신규** |
| `PartnerProfile` | `sessions ChargeSessionProjection[]` **신규 추가** |

---

## 2. Cross-schema FK 처리 표

| FK | 방향 | Phase 3-A 상태 | Phase 3-B 처리 |
|----|------|----------------|----------------|
| `ChargingStation.siteId → ChargingSite.id` | core → portal | 유지 (cross-schema FK) | **Logical FK로 전환** (relation 제거, siteId Int? 유지) |
| `Transaction.settlementId → Settlement.id` | core → portal | 유지 | **필드 자체 제거** (ChargeSessionProjection으로 이전) |
| `RefundLog.transactionId → Transaction.id` | portal → core | 유지 (cross-schema FK) | **Logical FK로 전환** (relation 제거, transactionId Int 유지) |
| `Transaction.userId → User.id` | core → portal | 유지 | **현행 유지** (Phase 3-D 검토 예정) |
| `IdToken.userId → User.id` | core → portal | 유지 | **현행 유지** |
| `ChargeSessionProjection.siteId → ChargingSite.id` | portal → portal | 신규 | **Portal 내부 FK** (동일 schema) |
| `ChargeSessionProjection.partnerId → PartnerProfile.id` | portal → portal | 신규 | **Portal 내부 FK** (동일 schema) |
| `ChargeSessionProjection.settlementId → Settlement.id` | portal → portal | 신규 | **Portal 내부 FK** (동일 schema) |

---

## 3. ChargeSessionProjection 컬럼 사전

| 컬럼 | 타입 | 설명 | 소스 |
|------|------|------|------|
| `id` | `BigInt` PK | 자동 증가 PK | 신규 |
| `coreTransactionId` | `Int` UNIQUE | Core Transaction.id 참조 (Logical FK) | Core Transaction.id |
| `sessionId` | `String(100)` UNIQUE | 앱 노출 세션 ID | Core Transaction.sessionId |
| `stationId` | `String(50)` | Core ChargingStation.id 참조 (Logical FK) | Core Transaction.stationId |
| `siteId` | `Int?` | ChargingSite.id (Portal 내부 FK) | ChargingStation.siteId → ChargingSite |
| `partnerId` | `Int?` | PartnerProfile.id (Portal 내부 FK) | ChargingSite.partnerId |
| `connectorId` | `Int` | OCPP 커넥터 번호 | Core Transaction.connectorId |
| `idTag` | `String?` | RFID idTag | Core Transaction.idTag |
| `meterStart` | `BigInt` | 충전 시작 계량값 (Wh) | Core Transaction.meterStart |
| `meterStop` | `BigInt?` | 충전 종료 계량값 (Wh) | Core Transaction.meterEnd |
| `totalKwh` | `Decimal(12,3)?` | 총 충전량 (kWh) | 이벤트 계산 |
| `timeStart` | `DateTime` | 충전 시작 시각 | Core Transaction.timeStart |
| `timeEnd` | `DateTime?` | 충전 종료 시각 | Core Transaction.timeEnd |
| `status` | `String(30)` | Pending/Active/Stopped/Failed | Core Transaction.status |
| `stopReason` | `String?` | 종료 사유 | StopTransaction 이벤트 |
| `costVnd` | `BigInt?` | 최종 요금 (VND) | Core Transaction.costVnd |
| `unitPriceVnd` | `Int?` | 충전 시점 단가 | Core Transaction.unitPriceVnd |
| `marginRate` | `Decimal(5,2)?` | 리베이트율 스냅샷 | Core Transaction.marginRate |
| `settlementSchedule` | `SettlementSchedule?` | 정산 주기 스냅샷 | Core Transaction.settlementSchedule |
| `settlementDay` | `Int?` | 월간 정산일 스냅샷 | Core Transaction.settlementDay |
| `settlementDayOfWeek` | `Int?` | 주간 정산 요일 스냅샷 | Core Transaction.settlementDayOfWeek |
| `paymentStatus` | `PaymentStatus?` | 결제 처리 상태 (Core에서 이전) | 이전: Core Transaction.paymentStatus |
| `settlementId` | `Int?` | Settlement.id (Portal 내부 FK) | 이전: Core Transaction.settlementId |
| `lastEventAt` | `DateTime` | 마지막 이벤트 수신 시각 | 이벤트 기반 갱신 |
| `createdAt` | `DateTime` | 생성 시각 | |
| `updatedAt` | `DateTime` | 갱신 시각 | @updatedAt |

---

## 4. 마이그레이션 SQL 단계별 설명

파일: `prisma/migrations/20260525000001_remove_payment_fields_add_projection/migration.sql`

| 단계 | 작업 | 비고 |
|------|------|------|
| STEP 1 | `portal."PaymentStatus"` enum 생성 | core에서 portal로 이전. 이미 존재하면 SKIP |
| STEP 2 | `portal."charge_session_projection"` 테이블 생성 | 인덱스 7개, FK 3개, updatedAt 트리거 포함 |
| STEP 3 | 데이터 백필 | `core."transaction"` → `portal."charge_session_projection"` 크로스 스키마 INSERT |
| STEP 4 | 데이터 검증 | COUNT 비교, 샘플 검증 쿼리 (주석 처리) |
| STEP 5 | Core 컬럼 제거 | `paymentStatus`, `settlementId` + 관련 인덱스/FK 제거 |
| STEP 6 | Cross-schema FK 제거 | ChargingStation.siteId FK, RefundLog.transactionId FK Logical FK 전환 |
| STEP 7 | `core."PaymentStatus"` enum 제거 | 검증 완료 후 수동 실행 (주석) |

---

## 5. 운영 적용 절차

```
1. 데이터 백업
   pg_dump -U pvpentech -h <host> pvpentech_db > backup_phase3b_$(date +%Y%m%d_%H%M%S).sql

2. SQL 파일 검토
   cat prisma/migrations/20260525000001_remove_payment_fields_add_projection/migration.sql

3. STEP 1~3 실행 (새 테이블 생성 + 데이터 백필)
   psql -U pvpentech -h <host> -d pvpentech_db
   \i prisma/migrations/20260525000001_remove_payment_fields_add_projection/migration.sql
   -- 단, STEP 5 이후는 주석 처리 상태이므로 STEP 1~3만 자동 실행됨

4. 데이터 검증
   SELECT COUNT(*) FROM core."transaction";
   SELECT COUNT(*) FROM portal."charge_session_projection";
   -- 두 count 일치 확인

5. 샘플 검증
   SELECT t."id", t."paymentStatus", csp."paymentStatus"
   FROM core."transaction" t
   JOIN portal."charge_session_projection" csp ON csp."coreTransactionId" = t."id"
   WHERE t."paymentStatus" IS NOT NULL
   LIMIT 20;

6. STEP 5~6 실행 (컬럼 제거 + FK 제거)
   ALTER TABLE core."transaction" DROP CONSTRAINT IF EXISTS "transaction_settlementId_fkey";
   DROP INDEX IF EXISTS core."transaction_paymentStatus_settlementId_idx";
   DROP INDEX IF EXISTS core."transaction_settlementId_idx";
   ALTER TABLE core."transaction" DROP COLUMN IF EXISTS "paymentStatus", DROP COLUMN IF EXISTS "settlementId";
   ALTER TABLE core."charging_station" DROP CONSTRAINT IF EXISTS "charging_station_siteId_fkey";
   ALTER TABLE portal."refund_log" DROP CONSTRAINT IF EXISTS "refund_log_transactionId_fkey";

7. prisma generate 재실행
   npx prisma generate

8. 애플리케이션 재시작 및 헬스체크

9. 롤백 필요 시
   pg_restore -U pvpentech -h <host> -d pvpentech_db backup_phase3b_<timestamp>.sql
```

**주의사항**:
- STEP 3 데이터 백필 후 반드시 검증 후 STEP 5 실행
- `core."PaymentStatus"` enum 제거(STEP 7)는 애플리케이션 재시작 후 정상 동작 확인 이후 별도 실행
- 트래픽 있는 운영 환경에서는 백필을 배치로 나눠 실행 권장 (LIMIT/OFFSET)

---

## 6. 잔존 TypeScript 임시 수정 위치 (Phase 3-D에서 본격 처리)

모든 TODO(Phase 3-D) 주석이 달린 위치:

| 파일 | 수정 내용 | Phase 3-D 처리 |
|------|-----------|----------------|
| `packages/core/src/ocpp/handlers/startTransaction.handler.ts` | `site include` 제거, unitPriceVnd 기본값 3500 | Portal API로 siteId 기반 단가 조회 |
| `packages/core/src/ocpp/handlers/stopTransaction.handler.ts` | `station.site include` 제거 | 동상 |
| `packages/core/src/ocpp/handlers/statusNotification.handler.ts` | `site.partnerId` null 처리 | Portal API로 siteId → partnerId 조회 |
| `packages/core/src/repositories/station.repository.ts` | `site include` 제거 2곳 | 동상 |
| `packages/core/src/services/station.service.ts` | `site include`, site 검색 제거 3곳 | 동상 |
| `packages/core/src/routes/portal/cs/faultLogs.routes.ts` | `station.site include` 제거 | 동상 |
| `packages/core/src/routes/portal/cs/stations.routes.ts` | `station.site include` 제거 | 동상 |
| `packages/portal/src/jobs/processors/postChargeBilling.processor.ts` | paymentStatus → ChargeSessionProjection | Phase 3-D 본격 처리 |
| `packages/portal/src/jobs/paymentTimeout.job.ts` | paymentStatus 갱신 미완 | Phase 3-D 본격 처리 |
| `packages/portal/src/services/payment.service.ts` | paymentStatus → ChargeSessionProjection, site 제거 | Phase 3-D 본격 처리 |
| `packages/portal/src/services/charge.service.ts` | site 제거, paymentStatus → ChargeSessionProjection | Phase 3-D 본격 처리 |
| `packages/portal/src/services/refund.service.ts` | transaction.site 제거, Logical FK 처리 | Phase 3-D 본격 처리 |
| `packages/portal/src/services/settlement.service.ts` | Transaction → ChargeSessionProjection 기반 조회 전환 | Phase 3-D 검증 |
| `packages/portal/src/services/session.service.ts` | station.site → stationId 기반 필터 전환 | Phase 3-D 본격 처리 |
| `packages/portal/src/services/stats.service.ts` | station.site → stationId 기반 필터 전환 | Phase 3-D 본격 처리 |
| `packages/portal/src/services/partner.service.ts` | chargingStations count 제거 | Phase 3-D 본격 처리 |
| `packages/portal/src/repositories/partner.repository.ts` | findByStationId 재작성 (siteId 기반) | Phase 3-D 검증 |
| `packages/portal/src/repositories/site.repository.ts` | chargingStations include 제거 | Phase 3-D 본격 처리 |
| `packages/portal/src/repositories/transaction.repository.ts` | station.site include 제거 | Phase 3-D 본격 처리 |
| `packages/portal/src/routes/portal/cs/partners.routes.ts` | station.site include 제거 | Phase 3-D 본격 처리 |
| `packages/portal/src/routes/portal/partner/stations.routes.ts` | site.partnerId → siteId 기반 재작성 | Phase 3-D 본격 처리 |

---

## 7. 검증 결과

| 검증 항목 | 결과 |
|----------|------|
| `npx prisma format` | 통과 |
| `npx prisma validate` | 통과 ("The schema at prisma/schema.prisma is valid") |
| `npx prisma generate` | 성공 (Prisma Client v5.22.0 재생성) |
| `npm run build` | 성공 (TypeScript 컴파일 오류 없음) |

---

## 8. Phase 3-C/D 연계

| Phase | 내용 |
|-------|------|
| **3-C** | Core / Portal PrismaClient datasources 분리 (각 서비스가 자신의 schema만 접근) |
| **3-D** | 모든 TODO(Phase 3-D) 위치 본격 처리: site 단가 조회 Portal API 연동, paymentStatus 갱신 로직 ChargeSessionProjection 기반 완성, RefundLog/Settlement 서비스 로직 검증 |
