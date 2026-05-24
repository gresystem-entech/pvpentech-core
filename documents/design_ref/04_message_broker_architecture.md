# 04. 메시지 브로커 & 비동기 라우팅 아키텍처

## 1. 아키텍처 개요
CSMS Gateway(FastAPI)와 Backend(Django/Celery) 간의 통신은 **비동기 메시징**을 전제로 합니다. OCPP 요청/응답 패턴을 비동기로 매핑하기 위해 Redis의 Queue(List)와 Pub/Sub 기능을 혼용합니다.

## 2. Upstream (CP -> CSMS) Flow 설계
가상 충전기가 서버로 요청(예: `BootNotification`)을 보낼 때의 처리 흐름입니다.

1.  **FastAPI 파싱 & Queue Push:**
    *   FastAPI가 메시지 수신: `[2, "msg-123", "BootNotification", {...}]`
    *   메시지 Validation 후, Redis의 Celery Task Queue (예: `celery` 브로커 큐) 로 메시지를 직렬화하여 Job 생성 (또는 Redis List `ocpp:upstream`에 직접 RPUSH 후 분배).
2.  **응답 대기 (Pub/Sub):**
    *   FastAPI는 메시지 처리가 완료될 때까지 비동기로 기다려야 합니다. 고유 메시지 ID(`msg-123`) 채널을 구독(`SUBSCRIBE ocpp:response:msg-123`)하고 대기(`await queue/channel`). (단, 타임아웃 10초 설정)
3.  **Django/Celery 처리:**
    *   Celery Worker가 메시지를 Pop.
    *   `handle_boot_notification(payload)` 실행 -> DB 반영 상태 변경.
    *   성공 응답 데이터 생성: `[3, "msg-123", {"status": "Accepted", "currentTime": "..."}]`
4.  **응답 송신 (Publish):**
    *   Worker는 Redis `PUBLISH ocpp:response:msg-123` 채널로 응답 페이로드 발송.
    *   대기하던 FastAPI가 수신 후, WebSocket 턴을 이어받아 Virtual-CP로 최종 응답 전송.

## 3. Downstream (CSMS -> CP) Flow 설계
관리자(Django UI)가 기기에 명령(예: `RemoteStartTransaction`, `Reset`)을 내릴 때의 처리 흐름입니다.

1.  **Django Action 트리거:**
    *   관리자 UI(HTTP)에서 `POST /admin/reset` 요청 발생.
    *   Django 뷰 로직이 고유 메시지 ID(`msg-999`)를 생성 후, Redis Command Channel에 Publish: `PUBLISH ocpp:downstream:station-001` (페이로드: `[2, "msg-999", "Reset", {"type": "Hard"}]`)
    *   Django는 Redis에 임시 상태(예: Key `ocpp:pending:msg-999`)를 세팅하거나 바로 사용자 화면에 명령 전송 성공(응답 미수신 상태)을 리턴하며 비동기 큐 잡 모니터링을 구동.
2.  **FastAPI 채널 모니터 및 송신:**
    *   FastAPI는 연결된 기기의 채널(`ocpp:downstream:station-001`)을 계속 구독(Listen)하고 있음.
    *   메시지 수신 시, 해당 `station-001` WebSocket 객체를 꺼내어 `[2, "msg-999", "Reset", ...]` 즉시 전송.
3.  **CP 응답(CallResult) 수신 시 재라우팅:**
    *   CP가 `[3, "msg-999", {"status": "Accepted"}]` 응답을 FastAPI로 보냄.
    *   FastAPI는 이게 Downstream Command에 대한 응답임을 인지(메시지 ID 캐시 조회)하고, 결과를 다시 DB 저장/상태 업데이트용 Queue로 Toss하여 Django/Celery가 처리 이력을 남기도록 함.

## 4. Sequence Scenario 예시: TransactionEvent
`TransactionEvent(Action=Started)` 도착 시:

*   `CP` -> `FastAPI`: WebSocket Call 메시지 전송
*   `FastAPI`: `SchemaValidate(Pass)`. Redis Queue(`ocpp.q.transactions`) 로 Enqueue. `SUBSCRIBE msg_id_tx_123`
*   `Celery Worker`: 큐 Listen 중 이벤트 수집 (고속 처리를 위해 DB Bulk Update 패턴 적용). 해당 `transactionId` DB Row 생성, 상태 `Started` 변경.
*   `Celery Worker`: Redis `PUBLISH msg_id_tx_123` -> Payload: `[3, "...", {}]`
*   `FastAPI`: 수신 후 CP로 WebSocket 응답 전송.
*   *이 과정은 대용량 트래픽 처리를 위해 Worker 노드를 병렬 추가함에 따라 무한 확장 가능한 구조를 지님.*
