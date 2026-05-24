# Pvpentech CSMS Node.js 디자인 가이드 작성 결과 요약

- **작성일**: 2026-03-31
- **작성 기준**: `documents/design_ref/` 참조 문서 분석 결과

---

## 1. 분석한 참조 문서

| 파일 | 내용 |
|------|------|
| `01_csms_development_guide.md` | FastAPI + Redis + Django/Celery 기반 아키텍처, OCPP 처리 방식 |
| `03_db_design_guide.md` | Django ORM 기반 ERD 설계 (충전기, 트랜잭션, 계량 등) |
| `04_message_broker_architecture.md` | Redis Queue/Pub-Sub 기반 비동기 메시지 라우팅 설계 |
| `05_Pvpentech_API_Specification.md` | 앱과 통신하는 REST API 스펙 (로그인, 충전 시작/상태/종료) |
| `06_portal_implementation_plan.md` | 사용자 포털 3역할(CS/파트너/고객) 모델 및 기능 계획 |
| `Portal_detail.txt` | 고객센터 대시보드 상세 현황 요구사항 |

---

## 2. 작성된 디자인 가이드 목록

| 파일 | 제목 | 핵심 내용 |
|------|------|-----------|
| `01_system_architecture.md` | 전체 시스템 아키텍처 | Node.js 단일 스택으로 통합, 기술 스택 결정, 포트 구성 |
| `02_project_directory_structure.md` | 프로젝트 디렉토리 구조 | 레이어드 아키텍처 기반 폴더 구조, 파일 명명 규칙 |
| `03_ocpp_websocket_handler.md` | OCPP 1.6 WebSocket 핸들러 설계 | 연결 관리, 메시지 파싱/라우팅, 핸들러 구현, 상태 머신 |
| `04_database_schema.md` | PostgreSQL 데이터베이스 스키마 | Prisma 스키마 전체 정의, 인덱스 전략, 파티셔닝 |
| `05_rest_api_design.md` | REST API 설계 패턴 | 모바일/포털/관리 API 엔드포인트 목록, Controller 패턴 |
| `06_auth_design.md` | 인증/인가 설계 | JWT, 역할 기반 접근 제어, OCPP Basic Auth |
| `07_error_handling.md` | 에러 핸들링 패턴 | 커스텀 에러 클래스, 전역 핸들러, OCPP Graceful Failure |
| `08_environment_and_deployment.md` | 환경 설정 및 배포 | .env 구성, PM2, Nginx, 로컬 개발 환경 설정 |
| `09_charge_session_flow.md` | 충전 세션 흐름 설계 | 앱-CSMS-CP 시퀀스, 세션 상태 머신, 서비스 구현 |

---

## 3. 주요 아키텍처 결정 사항

### FastAPI/Django → Node.js 마이그레이션 핵심 변경점

| 항목 | 기존 (Python) | 신규 (Node.js) |
|------|--------------|----------------|
| OCPP WebSocket | FastAPI | `ws` 라이브러리 |
| REST API | Django + DRF | Express.js |
| 비동기 작업 | Celery + Redis | BullMQ (Redis) |
| ORM | Django ORM | Prisma 5.x |
| 메시지 브로커 패턴 | Redis Queue + Pub/Sub | 프로세스 내 EventEmitter + Promise |
| 인증 | Django 세션 + DRF JWT | JWT (stateless) |
| 관리자 UI | Django Admin | 포털 REST API |

### 핵심 설계 결정

1. **단일 Node.js 프로세스**: OCPP WebSocket과 REST API를 하나의 Express 앱으로 통합
   - 기존 FastAPI + Django 분리 구조의 복잡한 Redis 메시지 중계 제거
   - 프로세스 내 `Map<stationId, WebSocket>` 직접 접근으로 단순화

2. **OCPP 응답 대기**: Redis Pub/Sub 대신 `Promise + Map<messageId, resolver>` 패턴
   - 타임아웃: 30초
   - 단일 프로세스 환경에서 Redis 오버헤드 없이 처리

3. **앱 API 하위 호환**: 기존 앱 스펙(`{ detail: "..." }`, `sessionId` camelCase 등) 그대로 유지

4. **Prisma ORM**: 타입 안전성과 마이그레이션 관리 편의성 확보

---

## 4. 구현 우선순위 (권장)

### Phase 1 — 기반 인프라
- [ ] 프로젝트 초기 설정 (TypeScript, ESLint, Prettier)
- [ ] Prisma 스키마 작성 및 초기 마이그레이션
- [ ] 환경 변수 설정 (Zod 검증)
- [ ] 로거, 에러 핸들러 설정

### Phase 2 — OCPP 엔진
- [ ] WebSocket 서버 + 연결 관리자
- [ ] 메시지 파서, 라우터, 응답 대기 패턴
- [ ] 핵심 핸들러: BootNotification, Heartbeat, StatusNotification
- [ ] 핵심 핸들러: StartTransaction, StopTransaction, MeterValues

### Phase 3 — 모바일 충전 API (앱 연동)
- [ ] 인증 (로그인 / JWT)
- [ ] 충전 시작/상태/종료 API
- [ ] RemoteStartTransaction / RemoteStopTransaction 명령

### Phase 4 — 포털 API
- [ ] 고객센터(CS) CRUD API
- [ ] 파트너 API
- [ ] 고객 API
- [ ] 통계/대시보드 API

### Phase 5 — 운영 기능
- [ ] BullMQ 백그라운드 작업 (목표 달성 체크, 세션 타임아웃, 로그 만료 삭제)
- [ ] PM2 + Nginx 프로덕션 배포
- [ ] OCPP 메시지 로그 보관 주기 관리

---

## 5. 디자인 가이드 저장 위치

```
D:/projects/pvpentech2/documents/design_guide/
├── 01_system_architecture.md
├── 02_project_directory_structure.md
├── 03_ocpp_websocket_handler.md
├── 04_database_schema.md
├── 05_rest_api_design.md
├── 06_auth_design.md
├── 07_error_handling.md
├── 08_environment_and_deployment.md
└── 09_charge_session_flow.md
```
