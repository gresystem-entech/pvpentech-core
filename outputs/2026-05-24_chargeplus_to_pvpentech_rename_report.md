# chargeplus → pvpentech 브랜드 치환 보고서

**작업일**: 2026-05-24  
**대상 워크스페이스**: `E:/projects/pvpentech`

---

## 1. 치환 전후 카운트 요약

| 패턴 | 치환 전 | 치환 후 |
|------|---------|---------|
| `chargeplus` (소문자) | ~120건 | 0건 |
| `ChargePlus` (PascalCase) | ~130건 | 0건 |
| `chargeplus-csms` (복합어) | ~20건 | `pvpentech-csms`로 치환 |
| `chargeplus2` (숫자 포함) | ~15건 | `pvpentech` (숫자 제거) |
| `CHARGEPLUS` (대문자) | 0건 | 해당 없음 |
| `Charge Plus` / `charge-plus` / `charge_plus` | 0건 | 해당 없음 |

**잔존 보존 건수**: 1건 (`outputs/2026-05-21_system_split_design_review.md` 역사 참조)

---

## 2. 변경된 파일 목록 (카테고리별)

### src/ (소스 코드)
- `src/config/env.ts` — CORS_ORIGIN, CSMS_SERVER_URL, SWAGGER_PASSWORD 기본값
- `src/config/logger.ts` — service 이름
- `src/config/swagger.ts` — API 문서 title
- `src/server.ts` — 시작 로그 메시지
- `src/app.ts` — Swagger customSiteTitle
- `src/middlewares/swaggerAuth.middleware.ts` — REALM 문자열
- `src/routes/index.ts` — wsUrl 예시 값
- `src/services/payment.service.ts` — order_info 문자열 (2건)

### 루트 설정 파일
- `package.json` — name, description
- `package-lock.json` — name (2건)
- `ecosystem.config.js` — PM2 앱 이름
- `.env.example` — DATABASE_URL, CORS_ORIGIN, CSMS_SERVER_URL, SWAGGER_PASSWORD
- `CLAUDE.md` — 프로젝트 제목

### public/ (포털 정적 파일)
- `public/index.html` — title
- `public/portal/login.html` — title
- `public/portal/cs/index.html` — title, header title (2건)
- `public/portal/partner/index.html` — title, header title, i18n 문자열 (6건)
- `public/portal/customer/index.html` — title, header title, i18n 문자열 (6건)

### webapp/ (모바일 앱)
- `webapp/index.html` — meta 이름, 타이틀, 로그인 화면 브랜드명 (3건)
- `webapp/manifest.json` — name 필드

### scripts/
- `scripts/deploy.sh` — 앱 이름, 경로, 출력 메시지
- `scripts/server-deploy.sh` — 앱 디렉토리, 앱 이름, PM2 경로
- `scripts/deploy_remote.py` — 모듈 docstring, 원격 경로, tar 파일명, PM2 앱 이름
- `scripts/deploy_portal.py` — 원격 경로, 로컬 경로, 관리자 이메일, PM2 앱 이름
- `scripts/upload_login.py` — 로컬/원격 경로

### documents/design_guide/
- `01_system_architecture.md`
- `02_project_directory_structure.md`
- `04_database_schema.md`
- `05_rest_api_design.md`
- `06_auth_design.md`
- `08_environment_and_deployment.md`
- `09_charge_session_flow.md`
- `10_i18n_design.md`
- `11_portal_menu_structure.md`
- `12_charger_provisioning.md`
- `13_charging_site_management.md`
- `csms_pnc_implementation_spec_2026-05-11.md`
- `new_csms_specification.md`

### documents/design_ref/
- `05_ChargePlus_API_Specification.md`
- `05_ChargePlus_API_Specification_old.md`
- `06_portal_implementation_plan.md`

### outputs/ (보고서 문서)
- `auths_provisioning_revised_design.md`
- `charger_client_security_checklist.md`
- `charger_connection_implementation_plan.md`
- `charger_manufacturer_integration_guide.md`
- `charger_replacement_runbook.md`
- `compliance_review_report.md`
- `deployment_report.md`
- `design_guide_summary.md`
- `gcp_firewall_ssh_hardening_runbook.md`
- `i18n_design_summary.md`
- `implementation_progress.md`
- `implementation_summary.md`
- `manufacturer_token_import_runbook.md`
- `mobile_api_spec.md`
- `ocpp_spec_compliance_review.md`
- `pnc_implementation_guide.md`
- `pnc_operator_guide.md`
- `portal_frontend_report.md`
- `server_log_guide.md`
- `usage_scenario_impact_analysis.md`
- `usage_scenario_update_summary.md`

### .claude/ (에이전트 설정)
- `.claude/settings.local.json` — 허용 명령어 내 경로/파일명
- `.claude/agent-memory/design-compliance-reviewer/MEMORY.md`
- `.claude/agent-memory/design-compliance-reviewer/project_chargeplus_status.md`
- `.claude/agent-memory/project-design-architect/MEMORY.md`
- `.claude/agent-memory/project-design-architect/architecture_decisions.md`
- `.claude/agent-memory/project-design-architect/project_overview.md`
- `.claude/agents/design-compliance-reviewer.md`
- `.claude/agents/project-design-architect.md`

### docs/ (배포 가이드)
- `docs/aws_deploy.md`
- `docs/aws_deployment_guide.md`
- `docs/gcp_deployment_guide.md`
- `docs/deployment-guide.md`

---

## 3. 의도적으로 제외한 영역

| 영역 | 이유 |
|------|------|
| `node_modules/` | 외부 의존성 패키지 — 재설치 시 갱신됨 |
| `dist/` | 빌드 산출물 — 재빌드 시 갱신됨 |
| `.claude/agents/chargeplus-code-implementer.md` | 보류 (agent 정의 변경 별도 작업) |
| `.claude/agent-memory/chargeplus-code-implementer/` | 보류 (agent 정의 변경 별도 작업) |
| `outputs/.deployment_report.md.swp` | Vim 스왑 파일 — 삭제 처리 |

---

## 4. 보존된 역사 참조

**파일**: `outputs/2026-05-21_system_split_design_review.md`  
**위치**: 마지막 줄 (1401번)  
**내용**: `**참조 코드베이스**: \`D:/projects/chargeplus2\` (브랜치: \`fix/ocpp_message_log_all_directions\`, 커밋: \`e91d12e\`)`  
**이유**: 원본 분석 대상 코드베이스의 정확한 위치/브랜치/커밋 식별을 위한 역사 기록으로 보존

---

## 5. TypeScript 컴파일 검증

```
npx tsc --noEmit
```

**결과**: src/ 내 오류 0건.  
참고: tsconfig.json의 `scripts/` 포함 설정으로 인한 `rootDir` 불일치 오류는 **치환 전부터 존재하던 기존 이슈**이며, 이번 작업과 무관함.

---

## 6. Prisma 포맷 검증

```
npx prisma format
```

**결과**: `Formatted prisma\schema.prisma in 96ms` — 정상.

---

## 7. 누락 감지 grep 결과

```bash
grep -rl "chargeplus|ChargePlus" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . \
  | grep -v ".claude/agents/chargeplus-code-implementer" \
  | grep -v ".claude/agent-memory/chargeplus-code-implementer"
```

**결과**: `outputs/2026-05-21_system_split_design_review.md` 1건 — 의도적 보존 대상.

치환 완료.
