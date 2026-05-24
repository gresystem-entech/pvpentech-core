# Phase 2-B 완료 보고서 — Core Internal API

**작성일**: 2026-05-24
**작업 범위**: `packages/core/src/internal-api/` 신규 생성, `apps/server/src/app.ts` 마운트

---

## 1. 라우트 표

### 1-1. 충전기 상태 조회 (GET)

| 메서드 | 경로 | 응답 모드 | 설명 |
|--------|------|-----------|------|
| GET | `/api/internal/v1/stations` | 200 동기 | 목록 (status/keyword/page/limit 필터) |
| GET | `/api/internal/v1/stations/:stationId` | 200 동기 | 상세 (커넥터/프로비저닝/faultLog 포함) |
| GET | `/api/internal/v1/stations/:stationId/connection` | 200 동기 | `{ isConnected, lastHeartbeatAt }` |
| GET | `/api/internal/v1/stations/:stationId/connectors` | 200 동기 | 커넥터 목록 |
| GET | `/api/internal/v1/stations/:stationId/ocpp-messages` | 200 동기 | OCPP 메시지 로그 (페이지네이션) |
| GET | `/api/internal/v1/stations/:stationId/command-results` | 200 동기 | OCPP 명령 결과 이력 |

### 1-2. 원격 제어 명령 (POST, 비동기)

| 메서드 | 경로 | OCPP Action | 응답 |
|--------|------|-------------|------|
| POST | `/api/internal/v1/stations/:stationId/commands/reset` | Reset | 202 Accepted |
| POST | `/api/internal/v1/stations/:stationId/commands/change-availability` | ChangeAvailability | 202 Accepted |
| POST | `/api/internal/v1/stations/:stationId/commands/change-configuration` | ChangeConfiguration | 202 Accepted |
| POST | `/api/internal/v1/stations/:stationId/commands/get-configuration` | GetConfiguration | 202 Accepted |
| POST | `/api/internal/v1/stations/:stationId/commands/clear-cache` | ClearCache | 202 Accepted |
| POST | `/api/internal/v1/stations/:stationId/commands/unlock-connector` | UnlockConnector | 202 Accepted |
| POST | `/api/internal/v1/stations/:stationId/commands/trigger-message` | TriggerMessage | 202 Accepted |
| POST | `/api/internal/v1/stations/:stationId/commands/data-transfer` | DataTransfer | 202 Accepted |

비동기 응답 형식:
```json
{ "success": true, "data": { "messageId": "uuid", "action": "Reset", "status": "sent", "sentAt": "ISO8601" } }
```

### 1-3. 충전 세션 제어 (POST, 동기 30s)

| 메서드 | 경로 | OCPP Action | 응답 |
|--------|------|-------------|------|
| POST | `/api/internal/v1/sessions/start` | RemoteStartTransaction | 200 동기 |
| POST | `/api/internal/v1/sessions/:sessionId/stop` | RemoteStopTransaction | 200 동기 |

### 1-4. 펌웨어 관리

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/internal/v1/firmware/upload` | 파일 업로드 (multipart/form-data) |
| GET | `/api/internal/v1/firmware` | 목록 |
| POST | `/api/internal/v1/firmware/campaigns` | 캠페인 시작 |
| GET | `/api/internal/v1/firmware/campaigns/:id` | 캠페인 상세 |
| DELETE | `/api/internal/v1/firmware/campaigns/:id` | 캠페인 취소 |
| POST | `/api/internal/v1/stations/:stationId/firmware/update` | 단일 충전기 업데이트 |

### 1-5. 진단 및 설정

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/internal/v1/stations/:stationId/diagnostics` | 진단 요청 (GetDiagnostics) |
| GET | `/api/internal/v1/stations/:stationId/diagnostics` | 진단 이력 조회 |
| GET | `/api/internal/v1/stations/:stationId/config` | 충전기 설정 목록 |
| PUT | `/api/internal/v1/stations/:stationId/config/:key` | 설정 값 갱신(또는 생성) |

### 1-6. 프로비저닝 + 제조사

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/internal/v1/provisioning` | 프로비저닝 목록 |
| POST | `/api/internal/v1/provisioning` | 단일 충전기 사전 등록 |
| PUT | `/api/internal/v1/provisioning/:id/reject` | 거부 처리 |
| GET | `/api/internal/v1/manufacturers` | 제조사 목록 |
| POST | `/api/internal/v1/manufacturers` | 제조사 등록 |

---

## 2. 인증 방식

- **방식**: `Authorization: Bearer <token>` 헤더
- **환경변수**: `CSMS_INTERNAL_API_TOKEN` (필수, 32자 이상, 콤마 구분 복수 토큰 지원)
- **비교**: `crypto.timingSafeEqual` — timing-attack 방어
- **미설정 시**: 부팅 시 `logger.fatal` 후 즉시 예외 throw (서버 기동 불가)
- **실패 응답**: `401 { error: { code: "UNAUTHORIZED", message: "..." } }`

---

## 3. 에러 코드 표

| 코드 | HTTP | 발생 조건 |
|------|------|----------|
| `STATION_NOT_FOUND` | 404 | stationId 미존재 |
| `STATION_OFFLINE` | 422 | OCPP WebSocket 미연결 |
| `OCPP_TIMEOUT` | 504 | OCPP 응답 시간 초과 |
| `OCPP_REJECTED` | 422 | 충전기가 Rejected 응답 |
| `DUPLICATE_REQUEST` | 409 | 동일 Idempotency-Key 처리 중 |
| `UNAUTHORIZED` | 401 | Bearer 토큰 인증 실패 |
| `BAD_REQUEST` | 400 | 요청 유효성 오류 |
| `INTERNAL_ERROR` | 500 | 예상치 못한 서버 에러 |

에러 응답 형식: `{ error: { code, message } }`
(InternalApiError → Internal API 전용 핸들러, 그 외 AppError → 기존 errorHandlerMiddleware)

---

## 4. Idempotency 동작

1. `Idempotency-Key` 헤더 없음 → 통과 (GET 등 read-only 요청)
2. 첫 요청 → Redis에 `__IN_PROGRESS__` 마커 저장 (TTL 120s, NX flag)
3. 처리 완료 → Redis에 `{ status, body }` 저장 (TTL 86400s = 24h)
4. 동일 키 재요청 (처리 중) → `409 DUPLICATE_REQUEST`
5. 동일 키 재요청 (완료) → 캐시 응답 반환, `X-Idempotent-Replayed: true` 헤더
6. Redis 장애 → fail-open (미들웨어 통과, 서비스 중단 없음)
7. 5xx 에러는 캐싱하지 않음 (재시도 허용)

Redis 키 네임스페이스: `idempotency:internal:<Idempotency-Key>`

---

## 5. 기존 CS 포털 라우트와의 차이

| 구분 | CS 포털 (`/api/portal/cs/*`) | Internal API (`/api/internal/v1/*`) |
|------|------------------------------|-------------------------------------|
| 인증 | JWT Bearer (CS role) | Service-to-Service Bearer token |
| 호출자 | 브라우저 (CS 운영자) | Portal 서버 프로세스 |
| 응답 형식 | `{ success, data }` | `{ success, data }` 또는 `{ error: { code, message } }` |
| 명령 응답 | 동기 (OCPP 응답 대기) | 비동기 202 (commands) + 동기 (sessions) |
| Idempotency | 없음 | `Idempotency-Key` 헤더 지원 |
| 인터넷 노출 | O (nginx 통과) | X (Phase 2-E에서 포트 분리 예정) |

CS 포털 라우트(`/api/portal/cs/stations` 등)는 현행 유지. Phase 3~4에서 이관 예정.

---

## 6. Phase 2-C Portal CoreApiClient 호출 매핑 예시

```typescript
// Portal packages에서 CoreApiClient가 호출할 예시
const client = new CoreApiClient(env.CSMS_INTERNAL_API_BASE_URL, env.CSMS_INTERNAL_API_TOKEN);

// 충전기 목록
await client.get('/stations?status=Online&page=1');

// 원격 Reset (비동기, 202 Accepted)
await client.post('/stations/EN1000001/commands/reset', { type: 'Soft' }, {
  headers: { 'Idempotency-Key': uuidv4() }
});

// 세션 시작 (동기)
await client.post('/sessions/start', {
  stationId: 'EN1000001',
  connectorId: 1,
  idTag: 'RFID123456'
});

// 펌웨어 업로드
const form = new FormData();
form.append('file', buffer, { filename: 'fw.bin' });
form.append('version', '1.2.0');
await client.post('/firmware/upload', form);
```

---

## 7. 생성/수정 파일 목록

### 신규 생성
- `packages/core/src/internal-api/auth.middleware.ts`
- `packages/core/src/internal-api/idempotency.middleware.ts`
- `packages/core/src/internal-api/routes/stations.routes.ts`
- `packages/core/src/internal-api/routes/commands.routes.ts`
- `packages/core/src/internal-api/routes/sessions.routes.ts`
- `packages/core/src/internal-api/routes/firmware.routes.ts`
- `packages/core/src/internal-api/routes/diagnostics.routes.ts`
- `packages/core/src/internal-api/routes/provisioning.routes.ts`
- `packages/core/src/internal-api/index.ts`
- `packages/shared/src/errors/internalApiErrors.ts`

### 수정
- `packages/shared/src/config/env.ts` — `CSMS_INTERNAL_API_TOKEN`, `CSMS_INTERNAL_API_BASE_URL` 추가
- `.env.example` — 두 환경변수 예시 추가
- `apps/server/src/app.ts` — `/api/internal/v1` 마운트 추가
- `packages/core/src/index.ts` — `createInternalApiRouter`, `InternalApiError` export 추가
