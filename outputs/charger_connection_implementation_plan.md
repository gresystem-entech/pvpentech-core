# 충전기 접속 연동 구현 계획

- **작성일**: 2026-04-16
- **참조**: `documents/design_ref/charger_configuration.md`, `documents/design_guide/12_charger_provisioning.md`
- **상태**: 계획 수립 완료, 구현 대기

---

## 1. 배경 및 문제 분석

### 1.1 오늘 발생한 접속 오류 요약

Arduino 충전기(`EN0300140`)가 서버에 접속 시도했으나 1008(Unauthorized)로 거부됨.

**원인 진단:**
| 항목 | 현재 상태 | 요구 사항 |
|------|-----------|-----------|
| `EN0300140` DB 등록 여부 | 있음 (`isActive=true`) | — |
| `passwordHash` | `NULL` | 프로비저닝 완료 시 bcrypt 해시 |
| Arduino 전송 헤더 | `Authorization` 없음 | `Authorization: Basic base64(id:pwd)` |
| 서버 Auth 로직 | Auth 헤더 없으면 무조건 거부 | passwordHash 없으면 개방 허용 |

**임시 조치 (2026-04-16 적용):**  
`verifyOcppBasicAuth`에서 `passwordHash=NULL`인 경우 인증 없이 접속 허용하도록 수정.  
→ 이는 임시 조치이며, **정식 프로비저닝 플로우 완성 후 제거 또는 수정 필요**.

---

## 2. 설계 요건 vs 현재 구현 Gap 분석

### 2.1 프로비저닝 API

| 항목 | design_ref 요건 | 현재 구현 | 차이 |
|------|-----------------|-----------|------|
| 엔드포인트 | `POST /auths` | `POST /provision` | **경로 다름** |
| 요청 필드 | `{ "origin": "serialNumber" }` | `{ "serial_number": "..." }` | **필드명 다름** |
| 성공 응답 형식 | `{ code:200, status:"OK", message:"Success", timestamp:"...", data:{clientId, pwd} }` | `{ station_id, csms_server, uri, port, password }` | **응답 구조 다름** |
| 실패 응답 형식 | `{ code:400/401/404/500, status, message }` | 내부 에러 핸들러 (표준 포맷) | **형식 다름** |

### 2.2 OCPP WebSocket 연결

| 항목 | design_ref 요건 | 현재 구현 | 차이 |
|------|-----------------|-----------|------|
| 연결 URL | `wss://{ip}/{충전기ID}` | `ws(s)://{host}/ocpp/{stationId}` | **/ocpp/ prefix 차이** |
| 보안 프로파일 | Security Profile 2 (TLS + Basic Auth) | Basic Auth만 구현 (TLS는 리버스 프록시 의존) | TLS 적용 확인 필요 |
| 인증 방식 | `Authorization: Basic base64(clientId:pwd)` | 동일 | 일치 |

> **참고**: Arduino 로그 확인 결과 현재 `/ocpp/EN0300140` 경로로 접속 중이며 서버도 이를 처리함. 경로 변경은 펌웨어 업데이트가 필요하므로 서버에서 두 경로 모두 지원하는 방향으로 처리.

---

## 3. 구현 계획

### Phase 1 — 프로비저닝 API 정렬 (우선순위: 높음)

**목표**: 충전기 펌웨어에서 호출하는 API를 `design_ref` 사양에 맞게 추가

#### 3.1.1 `/auths` 엔드포인트 추가

`POST /auths` 엔드포인트를 신규 추가. 기존 `POST /provision`은 유지(CS 포털에서 계속 사용).

```
POST /auths
Content-Type: application/json

Request:
{
  "model": "CP100"        // 충전기 모델명
  "origin": "12345678"    // 충전기 시리얼번호
}

Response (성공 200):
{
  "code": 200,
  "status": "OK",
  "message": "Success",
  "timestamp": "2026-04-16 10:00:00",
  "data": {
    "clientId": "EN0300140",
    "pwd": "KQHYDcYAxItjjyKaMlA1HA==",
    "wsUrl": "wss://csms.pvpentech.com"
  }
}

Response (실패 400 - 요청 형식 오류):
{ "code": 400, "status": "Bad Request", "message": "Bad Request", "errors": null }

Response (실패 401 - 미등록 시리얼번호):
{ "code": 401, "status": "Unauthorized", "message": "Unauthorized", "errors": null }

Response (실패 404 - 충전기 없음):
{ "code": 404, "status": "Not Found", "message": "Not Found", "errors": null }

Response (실패 500 - 서버 오류):
{ "code": 500, "status": "Internal Server Error", "message": "Internal Server Error", "errors": null }
```

**구현 위치:**
- `src/routes/index.ts` — `router.post('/auths', ...)` 추가
- `src/controllers/auth.controller.ts` 또는 신규 `src/controllers/provision.controller.ts`에 `chargerAuth` 메서드 추가
- 내부 로직은 기존 `provisionService.provision(serialNumber)` 재사용

#### 3.1.2 충전기 사전 등록 선행 요건

`POST /auths` 호출 전, CS 포털에서 해당 충전기의 시리얼번호가 `charger_provisioning` 테이블에 `registered` 상태로 사전 등록되어 있어야 함.

**현재 프로비저닝 상태 확인 (EN0300140):**
```sql
SELECT id, serial_number, station_id, status FROM charger_provisioning
WHERE serial_number = 'EN0300140의 시리얼번호';
```

→ `EN0300140`은 DB에 직접 등록된 상태이므로 프로비저닝 레코드 없이 수동 생성된 것으로 보임.  
→ 정식 프로비저닝 플로우 완성 전까지 수동 등록 충전기는 임시 조치로 접속 허용.

---

### Phase 2 — OCPP WebSocket 경로 이중 지원 (우선순위: 중간)

**목표**: 현재 Arduino가 사용 중인 `/ocpp/{id}` 경로 유지 + 향후 `/{id}` 경로 지원

#### 3.2.1 서버 변경 불필요 (현재 OK)

현재 `src/ocpp/server.ts`에서 `/ocpp/{stationId}` 경로로 연결을 받고 있으며 Arduino도 이 경로를 사용함. 추가 변경 없음.

#### 3.2.2 펌웨어 기준 연결 URL 정의

프로비저닝 응답의 `csms_server` + `uri` 조합으로 충전기가 OCPP URL을 구성:

```
wss://{CSMS_SERVER_URL}/ocpp/{clientId}
```

`/auths` 응답에 다음을 포함:
```json
{
  "data": {
    "clientId": "EN0300140",
    "pwd": "...",
    "wsUrl": "wss://pvpentech.example.com/ocpp/EN0300140"
  }
}
```

→ 충전기가 직접 완성된 URL을 받으므로 경로 혼선 없음.

---

### Phase 3 — 인증 강화 (우선순위: 중간)

**목표**: 프로비저닝 플로우 완성 후 임시 조치(`passwordHash=NULL` 개방 허용) 제거

#### 3.3.1 현재 임시 조치 코드 (`src/utils/auth.ts`)

```typescript
// 임시 조치: passwordHash가 없는 경우 인증 없이 접속 허용
if (!station.passwordHash) return true;  // ← 추후 false로 변경 필요
```

#### 3.3.2 변경 시점

- `POST /auths` 엔드포인트 완성 및 테스트 완료 후
- 현장 배포된 모든 충전기가 정상적으로 프로비저닝 완료된 것이 확인된 후
- 변경 시: `if (!station.passwordHash) return false;`로 되돌림

---

### Phase 4 — TLS/WSS 적용 확인 (우선순위: 낮음 — 운영 환경)

**목표**: Security Profile 2 (TLS + Basic Auth) 완전 준수

- 현재: Nginx 리버스 프록시에서 SSL 종단 (HTTPS/WSS → HTTP/WS)
- 확인 사항: 실제 클라이언트가 `wss://` 프로토콜로 접속하는지 확인
- 운영 서버에 Nginx SSL 설정이 있다면 Security Profile 2 요건 충족

---

## 4. 구현 세부 명세

### 4.1 `/auths` 컨트롤러 메서드

```typescript
// src/controllers/provision.controller.ts 에 추가

chargerAuth = async (req: Request, res: Response): Promise<void> => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  try {
    // 요청 검증
    const schema = z.object({ origin: z.string().min(1).max(100) });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        code: 400, status: 'Bad Request', message: 'Bad Request', errors: null,
      });
      return;
    }

    const { origin } = parseResult.data;
    const result = await this.provisionService.provision(origin);

    res.json({
      code: 200,
      status: 'OK',
      message: 'Success',
      timestamp,
      data: {
        clientId: result.station_id,
        pwd: result.password,
        wsUrl: `${result.csms_server}/ocpp/${result.station_id}`,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ForbiddenError) {
      res.status(401).json({
        code: 401, status: 'Unauthorized', message: 'Unauthorized', errors: null,
      });
    } else if (error instanceof ConflictError) {
      // 이미 프로비저닝된 경우 - 기존 정보 재반환 또는 에러
      res.status(409).json({
        code: 409, status: 'Conflict', message: error.message, errors: null,
      });
    } else if (error instanceof NotFoundError) {
      res.status(404).json({
        code: 404, status: 'Not Found', message: 'Not Found', errors: null,
      });
    } else {
      res.status(500).json({
        code: 500, status: 'Internal Server Error',
        message: 'Internal Server Error', errors: null,
      });
    }
  }
};
```

### 4.2 라우터 등록

```typescript
// src/routes/index.ts 에 추가 (provisionRoutes 위)
router.post('/auths', provisionRateLimiter, provisionController.chargerAuth);
```

---

## 5. 작업 우선순위 및 체크리스트

### Phase 1 — 즉시 구현

- [ ] `POST /auths` 엔드포인트 추가 (경로, 요청/응답 포맷 design_ref 준수)
- [ ] `ProvisionController`에 `chargerAuth` 메서드 추가
- [ ] 기존 `provisionService.provision()` 재사용 (로직 중복 없이)
- [ ] Rate Limiting 적용 (기존 `provisionRateLimiter` 재사용)
- [ ] 응답에 `wsUrl` 필드 포함 (`csms_server + /ocpp/ + clientId`)
- [ ] `/auths` 동작 테스트 (시리얼번호 사전 등록 → `/auths` 호출 → OCPP 연결)

### Phase 2 — 현장 안정화 후

- [ ] 모든 현장 충전기 프로비저닝 완료 확인
- [ ] `src/utils/auth.ts`의 임시 조치 코드 제거 (passwordHash=NULL 시 false 반환)
- [ ] 기존 수동 등록 충전기(`EN0300140` 등)에 passwordHash 설정 or 재프로비저닝

### Phase 3 — 운영 환경 보안

- [ ] Nginx TLS 설정 확인 (WSS 적용 여부)
- [ ] `CSMS_SERVER_URL` 환경변수가 `wss://` 로 설정되어 있는지 확인
- [ ] `/auths` 엔드포인트 HTTPS 전용 강제 (HTTP로 들어오면 리다이렉트 또는 거부)

---

## 6. 프로비저닝 전체 플로우 (최종 목표)

```
[공장 출고 전]
  CS 포털 → POST /api/portal/cs/provisioning → { serialNumber: "SN-12345678" } 등록

[현장 설치 후 전원 투입]
  충전기 → POST /auths → { origin: "SN-12345678" }
  서버 → charger_provisioning 조회 → stationId 생성 → passwordHash 저장
  서버 → { code:200, data: { clientId:"EN1000001", pwd:"xxxx", wsUrl:"wss://.../ocpp/EN1000001" } }
  충전기 → 내부 설정 저장 후 재시작

[OCPP 연결]
  충전기 → WebSocket wss://.../ocpp/EN1000001
  헤더: Authorization: Basic base64("EN1000001:xxxx")
  서버 → passwordHash bcrypt 검증 → 연결 수립
  충전기 → BootNotification 전송
  서버 → BootNotification 응답 → 정상 운영 시작
```

---

## 7. 관련 파일 목록

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/routes/index.ts` | 수정 | `POST /auths` 라우트 추가 |
| `src/controllers/provision.controller.ts` | 수정 | `chargerAuth` 메서드 추가 |
| `src/utils/auth.ts` | 수정 예정 | 임시 조치 코드 제거 (Phase 2) |
| `src/services/provision.service.ts` | 유지 | 기존 로직 재사용 |
| `documents/design_ref/charger_configuration.md` | 참조 | 설계 기준 문서 |
