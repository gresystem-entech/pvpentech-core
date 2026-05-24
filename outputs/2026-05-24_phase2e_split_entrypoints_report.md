# Phase 2-E: Core / Portal 진입점 분리 보고서

**작성일**: 2026-05-24  
**작업 범위**: `apps/server` 단일 프로세스를 Core / Portal 두 독립 진입점으로 분리

---

## 1. 새 디렉토리 구조

```
apps/
├── server/                          # legacy: Core + Portal 단일 프로세스 (개발/통합)
│   └── src/
│       ├── index.ts                 # bootstrapCore + bootstrapPortal 호출
│       ├── app.ts                   # re-export (deprecated wrapper)
│       └── jobs/index.ts            # no-op (deprecated)
│
├── core-server/                     # 신규: Core 전용 프로세스
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # 엔트리 포인트
│       └── bootstrap.ts             # bootstrapCore(port) — export
│
└── portal-server/                   # 신규: Portal 전용 프로세스
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                 # 엔트리 포인트
        ├── bootstrap.ts             # bootstrapPortal(port) — export
        └── config/swagger.ts        # Portal Swagger 스펙

packages/
├── core/src/
│   ├── app.ts           (신규) createCoreApp() — Core Express 앱 팩토리
│   ├── bootstrap.ts     (신규) setupCoreInfra() — OCPP WS + Outbox Relay + Core Jobs
│   └── index.ts         (수정) createCoreApp, setupCoreInfra export 추가
│
├── portal/src/
│   ├── app.ts           (신규) createPortalApp() — Portal Express 앱 팩토리
│   ├── bootstrap.ts     (신규) setupPortalInfra() — Stream Consumer + Portal Jobs
│   ├── routes/index.ts  (신규) createPortalRouter() — 전체 Portal 라우터 팩토리
│   └── index.ts         (수정) createPortalApp, createPortalRouter, setupPortalInfra export 추가
│
└── shared/src/
    ├── config/env.ts    (수정) CORE_PORT, PORTAL_PORT, LEGACY_PORT 추가
    └── middlewares/index.ts (수정) applyCommonMiddlewares(), applyErrorHandler() 추가
```

---

## 2. 3개 진입점 책임 표

| 항목 | `apps/core-server` | `apps/portal-server` | `apps/server` (legacy) |
|------|-------------------|--------------------|----------------------|
| 포트 | `CORE_PORT` (기본 3001) | `PORTAL_PORT` (기본 3002) | `CORE_PORT` + `PORTAL_PORT` 동시 |
| OCPP WebSocket | O | X | O (core-server 위임) |
| Internal API `/api/internal/v1/*` | O | X | O (core-server 위임) |
| 펌웨어 다운로드 `/firmware/:filename` | O | X | O |
| 프로비저닝 `/auths` | O | X | O |
| Outbox Relay | O | X | O |
| Core BullMQ Jobs | sessionTimeout, ocppLogCleanup | X | O |
| REST API `/api/*` | X | O | O |
| Portal 라우트 `/api/portal/*` | X | O | O |
| Stream Consumer | X | O | O |
| Portal BullMQ Jobs | X | chargeGoal, settlement, postChargeBilling, refund | O |
| Swagger UI `/api-docs` | X | O | O |
| 정적 파일 (`public`, `webapp`) | X | O | O |

---

## 3. 부팅 함수 시그니처

### packages/core/src/bootstrap.ts
```typescript
export interface CoreInfraHandle {
  httpServer: http.Server;
  shutdown: () => Promise<void>;
}

export async function setupCoreInfra(httpServer: http.Server): Promise<CoreInfraHandle>
```

### apps/core-server/src/bootstrap.ts
```typescript
export interface CoreBootstrapHandle {
  shutdown: () => Promise<void>;
}

export async function bootstrapCore(port: number): Promise<CoreBootstrapHandle>
```

### packages/portal/src/bootstrap.ts
```typescript
export interface PortalInfraHandle {
  shutdown: () => Promise<void>;
}

export async function setupPortalInfra(): Promise<PortalInfraHandle>
```

### apps/portal-server/src/bootstrap.ts
```typescript
export interface PortalBootstrapHandle {
  shutdown: () => Promise<void>;
}

export async function bootstrapPortal(port: number): Promise<PortalBootstrapHandle>
```

---

## 4. 환경변수 표

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CORE_PORT` | `3001` | Core 서버 HTTP 포트 (OCPP WS 공유) |
| `PORTAL_PORT` | `3002` | Portal 서버 HTTP 포트 |
| `LEGACY_PORT` | `3000` | Legacy 통합 서버 참조용 (실제 사용 안 함) |
| `CSMS_INTERNAL_API_BASE_URL` | `http://localhost:3001/api/internal/v1` | Portal → Core Internal API URL (CORE_PORT 와 일치해야 함) |

---

## 5. 실행 명령 표

| 명령 | 진입점 | 설명 |
|------|--------|------|
| `npm run dev` | `apps/server/src/index.ts` | 개발 — Core + Portal 단일 프로세스 (hot-reload) |
| `npm run dev:core` | `apps/core-server/src/index.ts` | 개발 — Core 단독 기동 |
| `npm run dev:portal` | `apps/portal-server/src/index.ts` | 개발 — Portal 단독 기동 |
| `npm run build` | tsconfig.build.json | 3개 진입점 모두 컴파일 |
| `npm run start` | dist `.../server/src/index.js` | 프로덕션 legacy (Core + Portal 단일) |
| `npm run start:core` | dist `.../core-server/src/index.js` | 프로덕션 Core 전용 |
| `npm run start:portal` | dist `.../portal-server/src/index.js` | 프로덕션 Portal 전용 |

---

## 6. pm2 설정 변경

| 앱 이름 | 스크립트 | 포트 | 용도 |
|---------|---------|------|------|
| `pvpentech-core` | `.../core-server/src/index.js` | 3001 | 프로덕션 Core |
| `pvpentech-portal` | `.../portal-server/src/index.js` | 3002 | 프로덕션 Portal |
| `pvpentech-legacy` | `.../server/src/index.js` | 3001+3002 | 개발/마이그레이션 fallback |

프로덕션 배포:
```bash
pm2 start ecosystem.config.js --env production
# pvpentech-core + pvpentech-portal 두 프로세스 기동
```

---

## 7. 코드 중복 방지 설계

- `packages/shared/src/middlewares/index.ts` — `applyCommonMiddlewares()`, `applyErrorHandler()` 공유 미들웨어
- `packages/core/src/app.ts` — `createCoreApp()` Core Express 팩토리 (apps/core-server + apps/server 공유)
- `packages/portal/src/app.ts` — `createPortalApp()` Portal Express 팩토리 (apps/portal-server + apps/server 공유)
- `packages/portal/src/routes/index.ts` — `createPortalRouter()` 라우터 팩토리 (apps/server/src/routes/index.ts 에서 패키지 내부로 이전)
- `packages/core/src/bootstrap.ts` — `setupCoreInfra()` Core 인프라 부팅 (OCPP WS, Outbox, Jobs)
- `packages/portal/src/bootstrap.ts` — `setupPortalInfra()` Portal 인프라 부팅 (Consumer, Jobs)

---

## 8. 알려진 제한사항

1. **BullMQ Worker 중복 등록 주의**: `apps/server` (legacy) 기동 시 Core와 Portal 두 부팅 함수가 모두 BullMQ worker를 등록한다. `charge-goal` 큐의 경우 Core worker(sessionTimeout 전담)와 Portal worker(chargeGoal 전담)가 공존하며, job data의 `type` 필드로 분기하도록 설계되어 있다. 분리 프로세스에서는 이 문제가 없다.

2. **`apps/server/src/index.ts` 상대 경로 import**: legacy 진입점이 `apps/core-server/src/bootstrap.ts`와 `apps/portal-server/src/bootstrap.ts`를 상대 경로(`../../../apps/...`)로 import한다. TypeScript 컴파일은 정상 통과하나, 프로덕션 단독 실행은 반드시 `start:core` / `start:portal`을 사용할 것.

3. **단일 빌드 outDir**: 모든 진입점이 `apps/server/dist/` 아래 하나의 outDir로 빌드된다. `module-alias` 경로도 이에 맞춰 `apps/server/dist/packages/*` 를 바라본다. 각 진입점별 독립 빌드가 필요하면 tsconfig 분리 필요 (Phase 3 고려사항).

---

## 9. 다음 단계 (Phase 3)와의 연결

Phase 2-E로 **프로세스** 분리가 완료되었다. Phase 3에서는 **DB 논리 분리**를 진행한다:
- Core 전용 Prisma 스키마 (station, charger, OCPP log, outbox 테이블)
- Portal 전용 Prisma 스키마 (user, session, payment, settlement, refund 테이블)
- 공유 테이블 접근 정책 수립 (read-only cross-access vs. Internal API 경유)
- Core / Portal 각자의 DB connection pool 분리

---

## 10. 빌드 검증 결과

```
npm run build  →  TypeScript 컴파일 오류 0건

빌드 결과:
  apps/server/dist/apps/server/src/index.js         (legacy)
  apps/server/dist/apps/core-server/src/index.js    (core)
  apps/server/dist/apps/portal-server/src/index.js  (portal)
```
