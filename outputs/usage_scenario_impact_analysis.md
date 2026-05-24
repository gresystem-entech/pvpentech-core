# usage_scenario.txt 영향도 분석 보고서

- **작성일**: 2026-03-31
- **분석 대상**: `documents/design_ref/usage_scenario.txt` (신규 추가)
- **분석 범위**: 기존 디자인 가이드 7개 파일

---

## 1. 분석 개요

`usage_scenario.txt`는 기존 `Portal_detail.txt` 및 `06_portal_implementation_plan.md`에서 다루지 않았던 다음 세 가지 핵심 요소를 신규로 정의합니다.

1. **충전기 프로비저닝 플로우** — 충전기 최초 설치 시 serial_number 기반 등록 및 CSMS 접속정보 자동 제공
2. **파트너 관리 심화** — 마진율(%), 정산일자, 계좌정보, 즉시 정산(송금이체) 기능
3. **정산 관리 도메인** — 충전이력 기반 정산내역 조회, 파트너별/충전소별/기기별 정산 분리

---

## 2. 영역별 영향도 분석

### 2.1 충전기 프로비저닝

#### 신규 (기존 가이드에 없는 항목)

| 항목 | 내용 | 영향 파일 |
|------|------|-----------|
| 프로비저닝 전용 HTTP 엔드포인트 | `POST /provision` — serial_number 수신 후 CSMS 접속정보 반환 | `05_rest_api_design.md` |
| `charger_provisioning` 테이블 | 프로비저닝 상태(pending/provisioned/rejected) 관리 | `04_database_schema.md` |
| 충전기 아이디 생성 규칙 | `"EN" + 7자리 숫자` (예: EN1000001) | `04_database_schema.md`, `05_rest_api_design.md` |
| 프로비저닝 전용 라우터/서비스 | `provision.routes.ts`, `provision.service.ts` 신규 생성 | `02_project_directory_structure.md` |
| 프로비저닝 보안 인증 | serial_number 위변조 방지 (HMAC 서명 또는 화이트리스트 검증) | `06_auth_design.md` |

#### 변경 (기존 설계 수정 필요)

| 항목 | 현재 상태 | 변경 필요 내용 | 영향 파일 |
|------|-----------|---------------|-----------|
| `ChargingStation` 모델 | `serialNumber` 필드만 존재, 프로비저닝 상태 없음 | `provisionStatus` 필드 또는 별도 `charger_provisioning` 테이블 연결 | `04_database_schema.md` |
| 충전기 등록 플로우 | CS가 수동으로 DB에 직접 등록 | 프로비저닝 → 자동 `ChargingStation` 레코드 생성 흐름 추가 | `05_rest_api_design.md` |
| OCPP WebSocket 연결 시 stationId | 사전 등록된 stationId 가정 | 프로비저닝 완료 후 발급된 `"EN" + 7자리` ID로 연결 | `03_ocpp_websocket_handler.md` |

#### 일치 (기존 반영된 항목)

- `ChargingStation` 모델의 `serialNumber`, `id`, `isActive` 필드는 이미 존재
- OCPP Basic Auth 검증 로직 이미 설계됨
- `ChargingStation` 등록 API (`POST /api/portal/cs/stations`) 이미 존재

---

### 2.2 포탈 사용자 구분 및 가입 플로우

#### 신규

| 항목 | 내용 | 영향 파일 |
|------|------|-----------|
| 고객 즉시 Active 명시 | 시나리오에서 명확히 재확인 | 영향 없음 (이미 구현) |

#### 변경

| 항목 | 현재 상태 | 변경 필요 내용 | 영향 파일 |
|------|-----------|---------------|-----------|
| 파트너 가입 승인 주체 | `PATCH /api/portal/cs/partners/:id/approve` 존재 | usage_scenario는 "고객센터에서 승인"을 명시 — 현행 설계와 일치하나 API 명세 보강 필요 | `05_rest_api_design.md` |

#### 일치

- 3개 역할(cs/partner/customer) 구분 — `UserRole` enum 이미 정의
- `UserStatus` (pending/active/inactive) — 이미 구현
- 고객 즉시 active, 파트너 pending 후 승인 — `06_auth_design.md`에 이미 정의

---

### 2.3 고객센터(CS) 포탈 메뉴

#### 신규

| 항목 | 내용 | 영향 파일 |
|------|------|-----------|
| 대시보드 KPI 카드 | 온라인/오프라인/장애 충전기 수, 누적 장애건수/미처리 장애건수 | `05_rest_api_design.md` |
| 파트너 마진율(%) 설정 | `PartnerProfile`에 `marginRate` 필드 필요 | `04_database_schema.md` |
| 파트너 정산일자 설정 | `PartnerProfile`에 `settlementDay` 필드 필요 | `04_database_schema.md` |
| 파트너별 정산금액 계산/표시 | 충전금액 × 마진율 계산 서비스 | `05_rest_api_design.md` |
| 즉시 정산(송금이체) 버튼 | 정산 실행 API 필요 | `05_rest_api_design.md` |
| `settlements` 테이블 | 정산 이력 저장 (파트너별/충전소별/기기별) | `04_database_schema.md` |
| 충전소 등록 필드 확장 | 충전사업자명, 관리자 이름/전화번호 추가 | `04_database_schema.md` |
| 충전카드 이용중 여부 실시간 표시 | 인증+충전중 여부 — IdToken status + Transaction.Active 조합 | `05_rest_api_design.md` |
| 고객 Inactive → 카드 Rejected 연동 | User 상태 변경 시 IdToken 상태 자동 변경 로직 | `04_database_schema.md`, `05_rest_api_design.md` |
| OCPP 원격지원 메뉴 확장 | 펌웨어 다운로드 명령(UpdateFirmware) 전송 | `03_ocpp_websocket_handler.md`, `05_rest_api_design.md` |
| 메시지 로그 검색 확장 | 시간/충전기ID/메시지타입별 검색 — `action` 필드 인덱스 추가 필요 | `04_database_schema.md` |

#### 변경

| 항목 | 현재 상태 | 변경 필요 내용 | 영향 파일 |
|------|-----------|---------------|-----------|
| `PartnerProfile` 모델 | `businessName`, `businessNo`, `contactPhone`만 있음 | `marginRate`, `settlementDay`, `bankAccount` 필드 추가 | `04_database_schema.md` |
| `ChargingSite` 모델 | `siteName`, `address`, `unitPrice`, `partnerId`만 있음 | `chargeOperatorName`, `managerName`, `managerPhone` 필드 추가 | `04_database_schema.md` |
| `OcppMessage` 인덱스 | `(stationId, createdAt)`, `createdAt`만 존재 | `action` 필드 인덱스 추가 (메시지타입 검색용) | `04_database_schema.md` |
| `FaultLog` 모델 | `resolvedAt` 필드 없음 — 미처리 건수 집계 불가 | `resolvedAt IS NULL` 조건으로 미처리 집계 — 필드는 이미 존재하나 인덱스 추가 권장 | `04_database_schema.md` |
| 파트너 API 응답 | 파트너 기본 CRUD만 정의됨 | 마진율/정산일자 수정 API, 정산 실행 API 추가 | `05_rest_api_design.md` |
| 충전소 등록 API | 기본 필드만 정의 | 충전사업자, 관리자 정보 필드 추가 | `05_rest_api_design.md` |

#### 일치

- 대시보드 일별/주별/월별 충전량/금액/횟수 및 증감 — `design_ref/Portal_detail.txt`에서 이미 정의, `05_rest_api_design.md`에 API 존재
- 파트너 추가/승인/반려 API — 이미 정의
- 충전기/충전소 CRUD API — 이미 정의
- `FaultLog` 모델 및 장애이력 등록 API — 이미 구현
- OCPP 메시지 로그 조회 API — `GET /api/portal/cs/ops/messages` 이미 존재
- 충전카드(`PaymentCard`) 모델 — 이미 정의

---

### 2.4 파트너 포탈

#### 신규

| 항목 | 내용 | 영향 파일 |
|------|------|-----------|
| 계좌정보 등록 | 파트너의 정산금 수령 계좌 — `PartnerProfile`에 `bankAccount` 관련 필드 추가 | `04_database_schema.md`, `05_rest_api_design.md` |
| 파트너별 정산 내역 조회 | 본인 충전소의 정산 이력 열람 | `05_rest_api_design.md` |

#### 변경

| 항목 | 현재 상태 | 변경 필요 내용 | 영향 파일 |
|------|-----------|---------------|-----------|
| 파트너 API 응답 범위 | CS 메뉴의 파트너 관련 항목만 조회 | 계좌정보 등록/수정 API, 본인 정산내역 조회 API 추가 | `05_rest_api_design.md` |

#### 일치

- 파트너 대시보드, 소속 충전소/충전기 조회, 통계 — 이미 정의

---

### 2.5 고객 포탈

#### 신규

| 항목 | 내용 | 영향 파일 |
|------|------|-----------|
| 결제카드 정보 등록 (후불결제용) | 고객 자신의 결제카드 등록 — `PaymentCard` 모델 활용 | `05_rest_api_design.md` |

#### 변경

| 항목 | 현재 상태 | 변경 필요 내용 | 영향 파일 |
|------|-----------|---------------|-----------|
| 고객 API | 현재 RFID 카드 관리만 존재 | 결제카드(신용카드) 등록/조회/삭제 API 추가 — PaymentCard 모델 활용 | `05_rest_api_design.md` |

#### 일치

- 고객 충전이력 조회, 프로필 수정 — 이미 정의
- RFID 카드 관리 — 이미 정의
- `PaymentCard` 모델 — 이미 존재

---

## 3. 요약 테이블

| 구분 | 항목 수 | 주요 내용 |
|------|---------|-----------|
| 신규 | 17개 | 프로비저닝 플로우, 파트너 마진/정산, settlements 테이블, 계좌정보, 결제카드 API |
| 변경 | 10개 | PartnerProfile 필드 추가, ChargingSite 필드 추가, OcppMessage 인덱스, 충전기 등록 흐름 |
| 일치 | 14개 | 역할/상태 구분, 가입 플로우, 대시보드 통계, CRUD API, FaultLog, OCPP 메시지 로그 |

---

## 4. 영향받는 디자인 가이드 파일 목록

| 파일 | 영향 등급 | 영향 내용 요약 |
|------|-----------|---------------|
| `04_database_schema.md` | **높음** | charger_provisioning, PartnerProfile 필드 확장, ChargingSite 필드 확장, settlements, ocpp_message 인덱스 추가 |
| `05_rest_api_design.md` | **높음** | 프로비저닝 API, 파트너 마진/정산 API, 정산 관리 API, 계좌정보 API, 결제카드 API, 충전기 운영 API 추가 |
| `06_auth_design.md` | **중간** | 프로비저닝 인증 메커니즘 추가, 파트너 pending 상태 관리 보강 |
| `03_ocpp_websocket_handler.md` | **낮음** | UpdateFirmware Downstream 명령 추가, 프로비저닝 이후 연결 흐름 명시 |
| `01_system_architecture.md` | **낮음** | 프로비저닝 서비스 컴포넌트 언급 추가 |
| `02_project_directory_structure.md` | **낮음** | provision 관련 라우터/서비스/컨트롤러 파일 추가 |
| `09_charge_session_flow.md` | **없음** | 기존 충전 세션 흐름과 직접 충돌 없음 |

---

## 5. 신규 작성 필요 가이드

| 파일명 | 내용 |
|--------|------|
| `11_portal_menu_structure.md` | 역할별(CS/파트너/고객) 포탈 메뉴 전체 구조 설계 |
| `12_charger_provisioning.md` | 충전기 프로비저닝 플로우 및 API 설계 |

---

*작성자: Pvpentech 프로젝트 아키텍트*
*분석 기준일: 2026-03-31*
