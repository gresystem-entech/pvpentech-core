# usage_scenario.txt 반영 작업 완료 요약

- **작업일**: 2026-03-31
- **작업자**: Pvpentech 프로젝트 아키텍트

---

## 1. 수행 작업 목록

| 번호 | 작업 | 출력 파일 | 상태 |
|------|------|-----------|------|
| 1 | 영향도 분석 문서 작성 | `outputs/usage_scenario_impact_analysis.md` | 완료 |
| 2 | 포탈 메뉴 구조 가이드 신규 작성 | `documents/design_guide/11_portal_menu_structure.md` | 완료 |
| 3 | 충전기 프로비저닝 플로우 가이드 신규 작성 | `documents/design_guide/12_charger_provisioning.md` | 완료 |
| 4-1 | `04_database_schema.md` 업데이트 | `documents/design_guide/04_database_schema.md` | 완료 |
| 4-2 | `05_rest_api_design.md` 업데이트 | `documents/design_guide/05_rest_api_design.md` | 완료 |
| 4-3 | `06_auth_design.md` 업데이트 | `documents/design_guide/06_auth_design.md` | 완료 |

---

## 2. 신규 작성 가이드 요약

### 11_portal_menu_structure.md

- **목적**: 3개 역할(CS/파트너/고객)별 포탈 메뉴 전체 구조 정의
- **핵심 내용**:
  - CS 포탈 메뉴 트리: 대시보드 / 파트너 관리 / 충전소 관리 / 충전기 관리 / 사용자 관리 / 충전카드 관리 / 정산 관리 / 충전기 운영(운영변수/원격지원/메시지로그)
  - 파트너 포탈 메뉴 트리: 대시보드 / 내 충전소 / 내 충전기 / 통계 / 정산 내역 / 계좌정보
  - 고객 포탈 메뉴 트리: 대시보드 / 충전이력 / 결제카드 / 충전카드(RFID) / 내 프로필
  - 역할별 데이터 접근 범위 비교 매트릭스
  - i18n 키 목록 (portal.json 기준)

### 12_charger_provisioning.md

- **목적**: 충전기 최초 설치 시 serial_number 기반 자동 등록 플로우 설계
- **핵심 내용**:
  - 프로비저닝 시퀀스 다이어그램 (충전기 → 프로비저닝 서버 → OCPP CSMS 전환)
  - `POST /provision` 엔드포인트 설계 (요청/응답 형식, 에러 케이스)
  - 충전기 아이디 생성 규칙: `"EN" + 7자리 숫자` (시퀀스 테이블 기반 원자적 생성)
  - DB 설계: `charger_provisioning` 테이블, `station_id_sequence` 테이블
  - `ChargingStation` 모델 변경: `passwordHash`, `manufacturer` 필드 추가
  - 보안 설계: Rate Limiting, 1회용 비밀번호, IP 화이트리스트 옵션
  - OCPP WebSocket 연결 전환 흐름

---

## 3. 기존 가이드 변경 내용 요약

### 04_database_schema.md (v1.0 → v1.1)

| 변경 유형 | 대상 | 내용 |
|-----------|------|------|
| 신규 모델 | `ChargerProvisioning` | 프로비저닝 상태 관리 (serialNumber/stationId/status) |
| 신규 모델 | `StationIdSequence` | "EN" + 7자리 시퀀스 관리 |
| 신규 모델 | `Settlement` | 파트너별/충전소별/기기별 정산 이력 |
| 필드 추가 | `ChargingStation` | `passwordHash`, `manufacturer` |
| 필드 추가 | `ChargingSite` | `chargeOperatorName`, `managerName`, `managerPhone` |
| 필드 추가 | `PartnerProfile` | `marginRate`, `settlementDay`, `bankName`, `bankAccount`, `bankAccountHolder` |
| 인덱스 추가 | `OcppMessage` | `action` 단일 인덱스, `(stationId, action)` 복합 인덱스 |
| 인덱스 추가 | `FaultLog` | `resolvedAt` 인덱스 (미처리 장애건수 집계) |

### 05_rest_api_design.md (v1.0 → v1.1)

| 변경 유형 | API 그룹 | 추가 엔드포인트 |
|-----------|---------|----------------|
| 신규 그룹 | 프로비저닝 API | `POST /provision` |
| CS 확장 | 파트너 관리 | PATCH margin, PATCH settlement-day, POST settle, PATCH deactivate |
| CS 신규 | 충전카드 관리 | GET/PATCH id-tokens (이용중 여부, 차단/해제) |
| CS 신규 | 정산 관리 | 일별/주별/월별, 사용자별/파트너별/충전소별/기기별 조회, 즉시 정산 |
| CS 신규 | 프로비저닝 관리 | GET/POST/DELETE/PATCH provisioning, POST reset-password |
| CS 확장 | 충전기 운영 | GET online-stations, OCPP 메시지 action 필터, 원격지원(UpdateFirmware/GetDiagnostics/ChangeConfiguration) |
| CS 확장 | 충전소 등록 | 충전사업자/관리자 필드 포함 |
| OCPP 관리 확장 | admin API | UpdateFirmware, GetDiagnostics, ChangeConfiguration |
| 파트너 신규 | 정산/계좌 | GET/PUT settlements, GET/PUT bank-account |
| 고객 신규 | 결제카드 | GET/POST/DELETE payment-cards |
| 고객 변경 | RFID 카드 | `/cards` → `/rfid-cards` 명칭 명확화 |

### 06_auth_design.md (v1.0 → v1.1)

| 변경 유형 | 내용 |
|-----------|------|
| 섹션 추가 (7-1) | 프로비저닝 인증 — Rate Limiting, 1회용 비밀번호, HTTPS 강제 정책 |
| 섹션 추가 (7-2) | 역할별 포탈 메뉴 접근 권한 매핑 (`requireRole` 적용 패턴) |
| 가입 흐름 보강 | 파트너 비활성화, 고객 비활성화 시 IdToken Blocked 자동 처리 흐름 추가 |
| 체크리스트 추가 | v1.1 신규 보안 검토 항목 6개 추가 |

---

## 4. 아키텍처 관점 핵심 변경사항

### 4.1 도메인 신규 추가

```
기존 도메인: 기기관리 / 사용자인증 / 트랜잭션 / 충전소 / 결제 / 운영
신규 도메인: 프로비저닝 / 정산(Settlement)
```

### 4.2 충전기 등록 흐름 변경

```
기존: CS 담당자 → POST /api/portal/cs/stations → 수동 등록
신규: 
  (사전 등록) CS → POST /api/portal/cs/provisioning (serial_number)
  (현장 설치) 충전기 → POST /provision → 자동 ChargingStation 레코드 생성
  (OCPP 연결) 충전기 → wss://.../ocpp/EN1000001 (Basic Auth)
```

### 4.3 파트너 관리 기능 확장

```
기존: 파트너 CRUD + 승인/반려
신규: 마진율(%) 설정 + 정산일자 설정 + 계좌정보 + 즉시 정산(송금이체)
```

### 4.4 정산 도메인 신설

- `Settlement` 모델: 파트너별/충전소별/기기별/기간별 정산 이력 관리
- 즉시 정산 API: CS 포탈에서 버튼 클릭으로 송금이체 실행
- 정산 금액 계산: `totalAmount × marginRate / 100`

---

## 5. 후속 작업 권고 사항

| 우선순위 | 항목 | 설명 |
|----------|------|------|
| 높음 | Prisma 마이그레이션 실행 | v1.1 신규 모델 DB 반영 |
| 높음 | 프로비저닝 서비스 구현 | `provision.service.ts` 구현 (`12_charger_provisioning.md` 참조) |
| 높음 | Settlement 서비스 구현 | 정산 집계 로직, 마진율 계산, 즉시 정산 |
| 중간 | 고객 Inactive → IdToken Blocked 연동 | User 상태 변경 Hook 구현 |
| 중간 | OCPP UpdateFirmware 명령 구현 | `updateFirmware.command.ts` 신규 작성 |
| 중간 | OCPP 메시지 로그 `action` 검색 기능 | Repository 쿼리 업데이트 |
| 낮음 | 파트너 포탈 계좌정보 화면 구현 | 프론트엔드 연동 |

---

*작성자: Pvpentech 프로젝트 아키텍트*
*작성일: 2026-03-31*
