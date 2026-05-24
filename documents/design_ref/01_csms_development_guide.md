# 01. CSMS 개발 지시서 (CSMS Development Guide)

## 1. 시스템 아키텍처 개요
본 CSMS(Charging Station Management System)는 **FastAPI + Redis + Django/Celery** 형태의 느슨한 결합(Loosely Coupled) 아키텍처를 채택합니다. 
이를 통해 대규모 트래픽 병목 현상을 방지하고, 각 컴포넌트의 독립적인 스케일 아웃이 가능하도록 설계했습니다.

*   **FastAPI (CSMS Gateway):** 수만 대의 가상 충전기(Virtual-CP)와의 WebSocket 통신을 전담합니다. 실시간 연결 유지, 1차 JSON Schema 유효성 검사, TLS/MTLS(Security Profile 1~3) 종단 및 메시지 브로커(Redis)로의 페이로드 전달 역할을 수행합니다.
*   **Redis (Message Broker):** FastAPI와 Django 간의 중간 매개체. 비동기 메시지 라우팅, 업스트림 요청 큐잉(List based Queue), 다운스트림 명령 전달 및 응답 대기를 위한 Pub/Sub 채널로 활용됩니다.
*   **Django, Celery, PostgreSQL (CSMS Backend):** 비즈니스 로직(OCPP 16개 기능 블록)을 처리하는 핵심 코어입니다. 데이터 영속성 처리(PostgreSQL), Admin UI(관리자 화면) 제공, Celery worker를 통한 백그라운드 OCPP 메시지 비동기 처리를 담당합니다.

## 2. FastAPI 웹소켓 라우팅 및 JSON 스키마 미들웨어
*   **WebSocket Endpoint:** 
    *   라우트: `wss://<domain>/ocpp/2.0.1/{station_id}`
    *   연결 시 `Sec-WebSocket-Protocol: ocpp2.0.1` 협상을 확인하고, 연결된 `station_id`를 Redis 기반 연결 세션 매니저에 등록합니다.
*   **JSON Schema Validation Middleware:**
    *   FastAPI 수신단에 미들웨어/인터셉터를 두어, 들어오는 모든 OCPP Call(`[2, "id", "Action", {payload}]`) 메시지에 대해 **OCPP 2.0.1 공식 JSON Schema Validation**을 즉각 시도합니다.
    *   필수 필드(Mandatory) 누락, 타입 오류, 포맷 오류 시 백엔드로 보내지 않고 즉시 CallError(`[4, "id", "FormatViolation", "Invalid payload", {}]`)로 반환하여 백엔드 부하를 차단합니다.
*   **Security Profile 1, 2, 3 지원:**
    *   Profile 1: Basic Authentication (`Authorization` 헤더 파싱)
    *   Profile 2: TLS Client Certificate Authentication
    *   Profile 3: MTLS 지원을 위한 리버스 프록시(Nginx/HAProxy 등) 연동 또는 FastAPI의 SSL 옵션 활용. 인증서 강제 검증.

## 3. Django & Celery 기반 16개 기능 블록 비즈니스 로직
*   **OCPP Request 수신 (Upstream):** 
    FastAPI는 검증된 메시지를 Redis Queue(예: `ocpp:queue:upstream`)에 Push합니다. Django의 Celery Worker는 이 Queue를 Listen하며, 메시지의 `Action` 필드를 기준으로 각각의 서비스 레이어(비즈니스 룰) 함수로 분기합니다.
*   **기능 블록 예시 (A~P):**
    *   `Block A (Security)`: BootNotification, Certificate 처리 등. (Station Validation)
    *   `Block B (Provisioning)`: SetVariables, GetVariables 등 정책 설정.
    *   `Block E (Transaction)`: TransactionEvent(Started, Updated, Ended) 기반 DB 트랜잭션 원자성 보장.
    *   `Block G (Local Authorization)`: IdToken 검증 로직 구현.
*   **Celery 작업 분배:** 처리가 무거운 작업(예: 통계 집계)과 실시간 응답이 필요한 작업(예: BootNotification 응답)을 분리된 Celery Queue(`high_priority`, `low_priority`)로 관리하세요.

## 4. 예외 처리 및 OCTT 인증 대비 크래시 방지
*   **OCTT(Open Charge Testing Tool) 대비 엄격 모드:**
    *   OCTT는 수많은 엣지 케이스 및 비정상 페이로드를 전송하여 시스템의 Crash를 유도합니다.
    *   Python 코드에서의 예외(KeyError, ValueError 등) 발생 시 Celery Worker가 중단되지 않고, 반드시 `try-except` 블록으로 캐치하여 `CallError(InternalError)` 혹은 적절한 OCPP 정의 에러로 우아하게 실패(Graceful Failure)하도록 설계해야 합니다.
    *   DB 트랜잭션 충돌(Deadlock이나 Race Condition) 방지를 위해 트랜잭션 업데이트 시 `select_for_update()` 등 락 메커니즘을 적절히 활용하세요.
