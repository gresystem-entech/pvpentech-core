# 03. CSMS 백엔드 데이터베이스 ERD 가이드

## 1. 개요 (Django ORM 설계 원칙)
OCPP 2.0.1 데이터 모델링은 계층적(Hierarchical) 기기 관리와 복잡성을 다루어야 하므로, ORM 구조는 직관적인 릴레이션 매핑과 데이터 정합성에 중점을 둡니다.

## 2. 주요 도메인 테이블 및 필드 설명

### A. 기기 및 상태 관리 (Device & State)
*   **`ChargingStation` (충전소/기기 최상위 모델)**
    *   `id` (PK, String, max_length=50): 충전기 고유 식별자 (chargePointId)
    *   `model_name`, `vendor_name`, `firmware_version`
    *   `status`: 기기 전체 상태 (Network 연결 상태 파악용 Online/Offline 여부)
    *   `last_heartbeat_at` (Datetime)

*   **`EVSE` (Electric Vehicle Supply Equipment)**
    *   `id` (PK), `charging_station_id` (FK -> ChargingStation)
    *   `evse_id` (Integer): OCPP 2.0.1 스펙 내에서 고유 번호 (1번 이상)

*   **`Connector` (커넥터 개별 플러그)**
    *   `id` (PK), `evse_id` (FK -> EVSE)
    *   `connector_id` (Integer): 커넥터 고유 번호
    *   `connector_type`: (cCCS1, cCCS2, cType2 등)
    *   `current_status`: (Available, Occupied, Faulted 등 마지막 StatusNotification 기록)

### B. 인증 및 사용자 관리 (Authorization & Users)
*   **`IdTokenInfo` (인증 정보 레코드)**
    *   `id_token` (PK, String): RFID 태그, Mac 주소 등
    *   `type`: (eMAID, ISO14443, MacAddress 등)
    *   `status`: (Accepted, Blocked, Expired 등)
    *   `expiry_date` (Datetime): 토큰 만료 일시
    *   `user_id` (FK -> Django User/Customer, Nullable): 시스템 실제 사용자 연결용

### C. 트랜잭션 및 계량 (Transaction & Metering)
*   **`Transaction` (트랜잭션 이벤트 통합 모델)**
    *   `transaction_id` (PK, String): OCPP 2.0.1 트랜잭션 식별자 (문자열 형태)
    *   `charging_station` (FK), `evse_id` (Integer, Nullable)
    *   `id_token` (FK -> IdTokenInfo)
    *   `time_start`, `time_end`
    *   `meter_value_start` (Integer), `meter_value_end` (Integer): Wh 단위 누적량
    *   `transaction_state`: (Started, Charging, Stopped 등 상태 변경 트래킹)

*   **`MeterValue` (시계열 데이터 로깅 테이블)**
    *   `id` (PK, AutoField)
    *   `transaction_id` (FK -> Transaction)
    *   `timestamp` (Datetime)
    *   `measurand` (Energy.Active.Import.Register, Voltage, Current.Import 등)
    *   `value` (Float/Decimal), `unit` (W, V, A, Wh 등)
    *   *최적화 코멘트:* MeterValue 데이터는 방대해질 수 있으므로, PostgreSQL Partitioning 적용을 고려하세요.

### D. 기기 설정 변수 관리 (Device Configuration)
*   **`DeviceVariable` (B block - SetVariables / GetVariables 대응)**
    *   OCPP 2.0.1은 `Component`와 `Variable`의 조합으로 파라미터를 식별합니다.
    *   `id` (PK)
    *   `charging_station` (FK -> ChargingStation)
    *   `component_name` (String, 예: 'AuthCtrlr')
    *   `variable_name` (String, 예: 'AuthorizeRemoteStart')
    *   `variable_value` (String)
    *   `is_readonly` (Boolean)
    *   *Constraint:* `UniqueConstraint(fields=['charging_station', 'component_name', 'variable_name'])`
