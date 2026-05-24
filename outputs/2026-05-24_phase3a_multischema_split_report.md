# Phase 3-A: Prisma MultiSchema Split 완료 보고서

**작성일**: 2026-05-24  
**작업자**: Code Implementer Agent  
**참조 설계**: `outputs/2026-05-21_system_split_design_review.md` 섹션 2-2, 5-4  
**Prisma 버전**: 5.22.0

---

## 1. 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `prisma/schema.prisma` | generator `previewFeatures = ["multiSchema"]` 추가, datasource `schemas = ["core", "portal", "public"]` 추가, 모든 모델/enum에 `@@schema(...)` 추가 |
| `prisma/migrations/20260524000000_multi_schema_split_core_portal/migration.sql` | 운영 적용용 `ALTER TABLE SET SCHEMA` / `ALTER TYPE SET SCHEMA` SQL |

---

## 2. 모델별 Schema 할당 표

### Core 모델 (`@@schema("core")`) — 19개

| 모델 | 테이블명 | 비고 |
|------|----------|------|
| `ChargingStation` | `charging_station` | OCPP 충전기 마스터 |
| `Connector` | `connector` | 커넥터 상태 |
| `DeviceVariable` | `device_variable` | OCPP 설정 변수 |
| `OcppMessage` | `ocpp_message` | OCPP 메시지 로그 |
| `OcppCommandResult` | `ocpp_command_result` | CSMS→CP 명령 결과 |
| `DiagnosticsRequest` | `diagnostics_request` | 진단 요청 추적 |
| `Firmware` | `firmware` | 펌웨어 파일 메타 |
| `FirmwareCampaign` | `firmware_campaign` | 펌웨어 캠페인 |
| `FirmwareCampaignProgress` | `firmware_campaign_progress` | 캠페인 진행 상황 |
| `FaultLog` | `fault_log` | 충전기 장애 로그 |
| `OfflineLog` | `offline_log` | 오프라인 이력 |
| `Manufacturer` | `manufacturer` | 충전기 제조사 (v2.0) |
| `ChargerProvisioning` | `charger_provisioning` | 프로비저닝 이력 |
| `StationIdSequence` | `station_id_sequence` | 충전기 ID 시퀀스 |
| `ChargerConfig` | `charger_config` | 충전기 key-value 설정 |
| `IdToken` | `id_token` | RFID 인증 (Master: Core) |
| `Transaction` | `transaction` | 충전 트랜잭션 (Master: Core) |
| `MeterValue` | `meter_value` | 계량 데이터 (Master: Core) |
| `OutboxEvent` | `outbox_event` | Phase 2-A Outbox 이벤트 |

### Portal 모델 (`@@schema("portal")`) — 12개

| 모델 | 테이블명 | 비고 |
|------|----------|------|
| `User` | `user` | 회원 (cs/partner/customer) |
| `PartnerProfile` | `partner_profile` | 파트너 사업자 정보 |
| `PaymentCard` | `payment_card` | 결제 카드 |
| `Settlement` | `settlement` | 정산 레코드 |
| `RefundLog` | `refund_log` | 환불 이력 |
| `RefundAttempt` | `refund_attempt` | 환불 시도 이력 |
| `PgConfig` | `payment_pg_config` | PG 설정 |
| `PaymentOrder` | `payment_order` | 결제 주문 |
| `CsmsVariable` | `csms_variable` | 시스템 운영 변수 |
| `ChargingSite` | `charging_site` | 충전소 (Portal 보유) |
| `SitePriceHistory` | `site_price_history` | 단가 변경 이력 |
| `ConsumedEvent` | `consumed_event` | Phase 2-A Portal 이벤트 소비 이력 |

---

## 3. Enum 처리 방식

모든 enum을 사용하는 모델의 schema에 단독 배치. cross-schema enum 사용 없음.

### Core enums (15개)

`StationStatus`, `ConnectorStatus`, `IdTokenType`, `IdTokenStatus`, `PaymentStatus`, `TransactionStatus`, `GoalType`, `OcppCommandStatus`, `DiagnosticsStatus`, `FirmwareCampaignStatus`, `FirmwareCampaignProgressStatus`, `FaultType`, `FaultStatus`, `ProvisioningStatus`, `ChargerConfigStatus`

### Portal enums (8개)

`UserRole`, `UserStatus`, `SettlementSchedule`, `SettlementPeriod`, `SettlementStatus`, `RefundStatus`, `RefundAttemptStatus`, `PayOrderStatus`

### 특이 케이스: `SettlementSchedule` enum

`SettlementSchedule`은 `PartnerProfile` (portal)과 `Transaction` (core) 양쪽에서 사용됩니다.

**결정**: `@@schema("portal")` 배치. `Transaction.settlementSchedule` 필드는 core 테이블에 있지만 컬럼 타입을 `portal."SettlementSchedule"`로 cross-schema 참조.

**이유**: Phase 3-B에서 `Transaction.settlementSchedule`은 정산 snapshot 필드로 유지하되, Phase 3-B/D에서 해당 필드들을 Portal 투영 테이블로 이전할 예정이므로 이번에는 그대로 유지합니다. Prisma 5.x + PostgreSQL은 cross-schema enum 참조를 지원합니다.

생성된 SQL에서 확인됨:
```sql
"settlementSchedule" "portal"."SettlementSchedule",
```

---

## 4. Cross-Schema Relation 목록 및 처리 방법

| FK | 방향 | 처리 | Phase |
|----|------|------|-------|
| `ChargingStation.siteId → ChargingSite.id` | core → portal | **그대로 유지** (Prisma multiSchema cross-schema FK 지원) | 3-B/D에서 Logical FK로 변경 예정 |
| `Transaction.settlementId → Settlement.id` | core → portal | **그대로 유지** (Phase 3-B 처리 대상) | 3-B에서 컬럼 제거 예정 |
| `Transaction.userId → User.id` | core → portal | **그대로 유지** (cross-schema FK) | 장기: Phase 3-B에서 Logical FK 검토 |
| `RefundLog.transactionId → Transaction.id` | portal → core | **그대로 유지** (cross-schema FK) | 3-B/D에서 Logical FK로 변경 예정 |
| `IdToken.userId → User.id` | core → portal | **그대로 유지** (cross-schema FK) | Portal이 RFID 관리 시 Core API 경유 정책 |
| `Transaction.stationId → ChargingStation.id` | core → core | 동일 schema, 문제 없음 | - |
| `Settlement.partnerId → PartnerProfile.id` | portal → portal | 동일 schema, 문제 없음 | - |

PostgreSQL은 cross-schema FK를 네이티브 지원합니다. Prisma 5.x multiSchema preview도 동일하게 지원하며, 생성된 SQL에서 다음과 같이 명확히 확인됩니다:

```sql
ALTER TABLE "core"."charging_station" ADD CONSTRAINT "charging_station_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "portal"."charging_site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "core"."transaction" ADD CONSTRAINT "transaction_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "portal"."settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "portal"."refund_log" ADD CONSTRAINT "refund_log_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "core"."transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

---

## 5. 마이그레이션 SQL 검토 결과

### 5-1. `prisma migrate diff --from-empty` 생성 SQL 분석

`prisma migrate dev --create-only`는 DB 연결이 필요하므로 로컬 DB 없이 `prisma migrate diff --from-empty --to-schema-datamodel`로 SQL을 추출했습니다.

**중요**: 이 SQL은 **신규 설치용 DDL** (CREATE TABLE)입니다. 운영 DB에 이미 테이블이 존재하므로 이 SQL을 직접 적용하면 오류 발생합니다.

### 5-2. 운영 적용용 SQL (migration.sql)

`ALTER TABLE SET SCHEMA` 방식으로 별도 작성했습니다. 이 방식은:
- 데이터를 보존하면서 테이블을 다른 schema로 이동
- 인덱스, FK 제약이 자동으로 따라감
- PostgreSQL 표준 방식 (데이터 손실 없음)

**추가 처리**:
- `ALTER TYPE SET SCHEMA` — enum 타입 이동
- `ALTER SEQUENCE SET SCHEMA` — SERIAL 컬럼 시퀀스 이동 (Prisma가 시퀀스를 올바르게 인식하려면 동일 schema 필요)

---

## 6. 검증 결과

| 검증 항목 | 결과 |
|----------|------|
| `npx prisma format` | 통과 (75ms) |
| `npx prisma validate` | 통과 ("The schema at prisma/schema.prisma is valid") |
| `npx prisma generate` | 성공 (Prisma Client v5.22.0 생성) |
| `npm run build` | 성공 (TypeScript 컴파일 오류 없음) |

---

## 7. 운영 적용 절차

```
1. 백업
   pg_dump -U pvpentech -h <host> pvpentech_db > backup_$(date +%Y%m%d).sql

2. SQL 파일 검토
   cat prisma/migrations/20260524000000_multi_schema_split_core_portal/migration.sql

3. 실행 (psql)
   psql -U pvpentech -h <host> -d pvpentech_db \
     -f prisma/migrations/20260524000000_multi_schema_split_core_portal/migration.sql

4. 검증 쿼리 실행
   SELECT schemaname, tablename FROM pg_tables
     WHERE schemaname IN ('core', 'portal')
     ORDER BY schemaname, tablename;

5. prisma generate 재실행
   npx prisma generate

6. 애플리케이션 재시작 및 헬스체크

7. 롤백이 필요한 경우
   pg_restore -U pvpentech -h <host> -d pvpentech_db backup_<날짜>.sql
```

**주의사항**:
- `search_path` 설정: 운영 DB에서 `ALTER DATABASE pvpentech_db SET search_path TO core, portal, public;` 설정을 권장합니다. 단, Prisma는 모델 레벨 `@@schema()` 기반으로 fully-qualified 이름을 사용하므로 search_path 없이도 동작합니다.
- FK 순서: `ALTER TABLE SET SCHEMA`는 FK 제약이 있어도 단일 테이블 이동 가능합니다. 다만 참조 무결성 점검 타이밍에 따라 오류가 날 수 있으므로 FK 제약을 일시 비활성화 후 이동하는 방법도 있습니다.

---

## 8. Phase 3-B/C/D 연계

| Phase | 내용 | 관련 Schema |
|-------|------|-------------|
| **3-B** | `Transaction.paymentStatus`, `settlementId`, `settlementSchedule`, `settlementDay`, `settlementDayOfWeek` 필드를 Core에서 제거 → Portal에 `charge_session_projection` 투영 테이블 신설 | core/portal |
| **3-B** | `ChargingStation.siteId → ChargingSite.id` FK를 Logical FK로 변경 (FK 제약 제거, siteId Int 컬럼만 유지) | core/portal |
| **3-B** | `RefundLog.transactionId → Transaction.id` FK를 Logical FK로 변경 | portal/core |
| **3-B** | `IdToken.userId → User.id` FK Logical 변경 검토 | core/portal |
| **3-C** | Core / Portal 별도 진입점의 PrismaClient `datasources` 분리 (각 서비스가 자신의 schema만 접근) | - |
| **3-D** | PnC 모델 제거 (`PncInstalledCertificate`, `PncCsrInProgress`, `PncAuditLog`) | core |

---

## 9. 특이 사항

- **`prisma migrate dev --create-only` 미실행**: 로컬 PostgreSQL DB 없음. `prisma migrate diff --from-empty`로 신규 설치 DDL을 추출하여 참조 자료로 확인하고, 운영용 `ALTER TABLE SET SCHEMA` SQL은 별도 수동 작성했습니다.
- **Prisma 5.22 → 최신 버전 업그레이드 알림**: `npx prisma generate` 실행 시 v7.8.0으로 업그레이드 권고가 표시됩니다. 주요 버전 업그레이드이므로 별도 검토 후 진행 권장.
