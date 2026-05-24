-- =============================================================================
-- Phase 3-A: Multi-Schema Split (core / portal)
-- 생성일: 2026-05-24
-- 목적: public schema에 있는 기존 테이블을 core / portal PostgreSQL schema로 이동
--
-- !! 운영 적용 전 반드시 백업 후 진행 !!
-- !! prisma migrate dev --create-only 로 생성된 SQL은 신규 설치 DDL이므로
--    운영 DB에는 이 파일(ALTER TABLE SET SCHEMA)을 사용하세요 !!
--
-- 적용 순서:
--   1. pg_dump 등으로 전체 DB 백업
--   2. 이 SQL 파일을 검토
--   3. psql -U <user> -d <db> -f migration.sql
--   4. prisma generate 재실행
--   5. 애플리케이션 재시작 후 동작 검증
-- =============================================================================

-- Step 1: schema 생성
CREATE SCHEMA IF NOT EXISTS "core";
CREATE SCHEMA IF NOT EXISTS "portal";

-- =============================================================================
-- Step 2: core schema로 이동할 테이블
-- (기존 public schema 테이블을 core로 이동)
-- =============================================================================

ALTER TABLE IF EXISTS "public"."charging_station"          SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."connector"                 SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."device_variable"           SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."ocpp_message"              SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."ocpp_command_result"       SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."diagnostics_request"       SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."firmware"                  SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."firmware_campaign"         SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."firmware_campaign_progress" SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."fault_log"                 SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."offline_log"               SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."manufacturer"              SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."charger_provisioning"      SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."station_id_sequence"       SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."charger_config"            SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."id_token"                  SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."transaction"               SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."meter_value"               SET SCHEMA "core";
ALTER TABLE IF EXISTS "public"."outbox_event"              SET SCHEMA "core";

-- =============================================================================
-- Step 3: portal schema로 이동할 테이블
-- =============================================================================

ALTER TABLE IF EXISTS "public"."user"                      SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."partner_profile"           SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."payment_card"              SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."settlement"                SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."refund_log"                SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."refund_attempt"            SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."payment_pg_config"         SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."payment_order"             SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."csms_variable"             SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."charging_site"             SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."site_price_history"        SET SCHEMA "portal";
ALTER TABLE IF EXISTS "public"."consumed_event"            SET SCHEMA "portal";

-- =============================================================================
-- Step 4: enum 타입 이동
-- PostgreSQL은 ALTER TYPE ... SET SCHEMA를 지원함
-- =============================================================================

-- core enums
ALTER TYPE IF EXISTS "public"."StationStatus"                    SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."ConnectorStatus"                  SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."IdTokenType"                      SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."IdTokenStatus"                    SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."PaymentStatus"                    SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."TransactionStatus"                SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."GoalType"                         SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."OcppCommandStatus"                SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."DiagnosticsStatus"                SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."FirmwareCampaignStatus"           SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."FirmwareCampaignProgressStatus"   SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."FaultType"                        SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."FaultStatus"                      SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."ProvisioningStatus"               SET SCHEMA "core";
ALTER TYPE IF EXISTS "public"."ChargerConfigStatus"              SET SCHEMA "core";

-- portal enums
ALTER TYPE IF EXISTS "public"."UserRole"                         SET SCHEMA "portal";
ALTER TYPE IF EXISTS "public"."UserStatus"                       SET SCHEMA "portal";
ALTER TYPE IF EXISTS "public"."SettlementSchedule"               SET SCHEMA "portal";
ALTER TYPE IF EXISTS "public"."SettlementPeriod"                 SET SCHEMA "portal";
ALTER TYPE IF EXISTS "public"."SettlementStatus"                 SET SCHEMA "portal";
ALTER TYPE IF EXISTS "public"."RefundStatus"                     SET SCHEMA "portal";
ALTER TYPE IF EXISTS "public"."RefundAttemptStatus"              SET SCHEMA "portal";
ALTER TYPE IF EXISTS "public"."PayOrderStatus"                   SET SCHEMA "portal";

-- =============================================================================
-- Step 5: 시퀀스 이동 (SERIAL 컬럼이 사용하는 시퀀스)
-- PostgreSQL은 SERIAL 컬럼 시퀀스를 별도로 추적함
-- 테이블과 동일한 schema에 있어야 Prisma가 올바르게 인식
-- =============================================================================

-- core 시퀀스
ALTER SEQUENCE IF EXISTS "public"."connector_id_seq"                          SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."device_variable_id_seq"                    SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."ocpp_message_id_seq"                       SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."ocpp_command_result_id_seq"                SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."diagnostics_request_id_seq"                SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."firmware_id_seq"                           SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."firmware_campaign_id_seq"                  SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."firmware_campaign_progress_id_seq"         SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."fault_log_id_seq"                          SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."offline_log_id_seq"                        SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."manufacturer_id_seq"                       SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."charger_provisioning_id_seq"               SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."charger_config_id_seq"                     SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."id_token_id_seq"                           SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."transaction_id_seq"                        SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."meter_value_id_seq"                        SET SCHEMA "core";
ALTER SEQUENCE IF EXISTS "public"."outbox_event_id_seq"                       SET SCHEMA "core";

-- portal 시퀀스
ALTER SEQUENCE IF EXISTS "public"."user_id_seq"                               SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."partner_profile_id_seq"                    SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."payment_card_id_seq"                       SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."settlement_id_seq"                         SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."refund_log_id_seq"                         SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."refund_attempt_id_seq"                     SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."payment_pg_config_id_seq"                  SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."payment_order_id_seq"                      SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."csms_variable_id_seq"                      SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."charging_site_id_seq"                      SET SCHEMA "portal";
ALTER SEQUENCE IF EXISTS "public"."site_price_history_id_seq"                 SET SCHEMA "portal";

-- =============================================================================
-- Step 6: _prisma_migrations 테이블도 public에 두거나 core/portal 중 하나로 이동
-- 권장: public에 그대로 유지 (Prisma 기본값)
-- =============================================================================

-- (선택사항) search_path 기본값 설정 — 운영 DB 레벨에서 설정 권장
-- ALTER DATABASE pvpentech_db SET search_path TO core, portal, public;

-- =============================================================================
-- 검증 쿼리 (적용 후 실행하여 이동 완료 확인)
-- =============================================================================
-- SELECT schemaname, tablename FROM pg_tables
--   WHERE tablename IN (
--     'charging_station','connector','transaction','settlement','user','refund_log'
--   )
--   ORDER BY schemaname, tablename;
--
-- SELECT n.nspname, t.typname FROM pg_type t
--   JOIN pg_namespace n ON t.typnamespace = n.oid
--   WHERE t.typtype = 'e'
--   ORDER BY n.nspname, t.typname;
