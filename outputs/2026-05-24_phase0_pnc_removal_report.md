# Phase 0 PnC 전면 제거 작업 보고서

**작업일**: 2026-05-24
**작업범위**: P0-T1 ~ P0-T5 (코드/스키마 제거. 운영 DB 마이그레이션은 별도)

---

## 1. 삭제된 파일 목록

### OCPP 핸들러 (P0-T1)
- `src/ocpp/handlers/pnc/authorize.handler.ts`
- `src/ocpp/handlers/pnc/signCertificate.handler.ts`
- `src/ocpp/handlers/pnc/get15118EvCertificate.handler.ts`
- `src/ocpp/handlers/pnc/getCertificateStatus.handler.ts`
- `src/ocpp/handlers/pnc/index.ts`

### OCPP 명령 (P0-T1)
- `src/ocpp/commands/pncSend.command.ts`

### 서비스/유틸/설정/스케줄러 (P0-T2)
- `src/services/pncPki.service.ts`
- `src/services/pncOcsp.service.ts`
- `src/services/pncAuditLog.service.ts`
- `src/services/pncConfig.service.ts`
- `src/services/pncCertExpiry.service.ts`
- `src/utils/ocspRequest.ts`
- `src/utils/asn1.ts`
- `src/config/pnc.ts`
- `src/jobs/schedulers/pncCertExpiry.scheduler.ts`

### 라우트 (P0-T3)
- `src/routes/portal/cs/pncOps.routes.ts`

---

## 2. 수정된 파일 목록 및 변경 요약

| 파일 | 변경 내용 |
|------|----------|
| `src/ocpp/commands/index.ts` | PnC 5종 명령 export 블록 삭제 (`sendCertificateSigned`, `sendInstallCertificate`, `sendDeleteCertificate`, `sendGetInstalledCertificateIds`, `sendPncTriggerMessage`) |
| `src/server.ts` | `logPncConfigOnce`, `registerPncHandlers`, `startPncCertExpiryScheduler`, `stopPncCertExpiryScheduler` 호출 및 관련 import 3줄 삭제 |
| `src/ocpp/handlers/bootNotification.handler.ts` | `syncPncConfig` import 및 호출 블록(setImmediate + setTimeout) 삭제 |
| `src/routes/index.ts` | `csPncOpsRoutes` import 및 `/api/portal/cs/pnc` 라우트 등록 삭제 |
| `src/config/env.ts` | `PKI_BASE_URL`, `OCSP_BASE_URL`, `PKI_API_ID`, `PKI_API_KEY`, `PNC_ENABLED_DEFAULT`, `PNC_TRIGGER_RENEWAL_DAYS`, `PNC_PKI_TIMEOUT_MS`, `PNC_OCSP_TIMEOUT_MS` 8개 변수 삭제 |
| `prisma/schema.prisma` | `ChargingStation` 모델에서 `pncCertificates`/`pncCsrs` relation 삭제. `PncInstalledCertificate`, `PncCsrInProgress`, `PncCsrStatus enum`, `PncAuditLog` 모델 전체 삭제 |

---

## 3. 잔존 PnC 키워드 grep 결과

`src/**/*.ts` 및 `prisma/schema.prisma` 대상으로 다음 패턴 검색:
```
pnc|Pnc|PNC|PKI_|OCSP_|ISO15118|15118|PlugAndCharge
```

**결과: 0건 (완전 제거 확인)**

문서 영역(`outputs/`, `documents/`) 잔존 파일:
- `outputs/pnc_implementation_guide.md` — 운영 참조용 가이드, 보존
- `outputs/pnc_operator_guide.md` / `.pdf` — 운영 참조용, 보존
- `documents/design_guide/csms_pnc_implementation_spec_2026-05-11.md` — 향후 재구현 참조용, 보존 (명시적 지시)

---

## 4. 컴파일 검증 결과

```
npx tsc --project tsconfig.build.json --noEmit
→ 오류 없음 (exit 0)
```

참고: `tsconfig.json` (루트) 기준 검증 시 `scripts/` 디렉토리가 `rootDir: src`를 벗어나는 기존 설정 오류 3건 발생 — PnC 제거와 무관한 기존 문제이며 `tsconfig.build.json` 기준으로는 오류 없음.

---

## 5. 다음 단계 (운영 DB 마이그레이션)

**코드/스키마 제거는 완료되었으나, 운영 PostgreSQL DB에는 아직 PnC 테이블이 존재한다.**
운영 데이터 백업 완료 후 아래 절차를 수동으로 수행할 것:

```sql
-- 운영 DB에서 직접 실행 (마이그레이션 파일 생성 없이 수행)
DROP TABLE IF EXISTS pnc_audit_log;
DROP TABLE IF EXISTS pnc_csr_in_progress;
DROP TABLE IF EXISTS pnc_installed_certificate;
DROP TYPE IF EXISTS "PncCsrStatus";
```

또는 `prisma migrate` 워크플로우를 사용한다면:
```bash
npx prisma migrate dev --name remove_pnc_models
```
(이 경우 로컬 DB에서 선행 테스트 후 운영 적용)

**주의**: 운영 DB에 PnC 데이터가 존재하는 상태에서 새 코드를 배포해도 Prisma Client는 해당 테이블을 참조하지 않으므로 런타임 오류 없이 정상 동작함. DB 테이블 삭제는 배포 후 별도 일정으로 진행 가능.
