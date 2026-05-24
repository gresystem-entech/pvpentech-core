# Pvpentech CSMS Deployment Report

**Date:** 2026-04-01  
**Target Server:** 192.168.0.25 (Ubuntu, user: jeongsooh)  
**Deploy Path:** /opt/pvpentech  
**Process Manager:** PM2 (app name: pvpentech-csms)

---

## Build Phase

### TypeScript Errors Fixed (15 categories)

| File | Error | Fix Applied |
|------|-------|-------------|
| `src/config/i18n.ts` | Missing export `i18n` | Added `export { i18next as i18n }` |
| `src/middlewares/requestLogger.middleware.ts` | Function named `requestLogger`, imported as `requestLoggerMiddleware` | Renamed export |
| `src/middlewares/errorHandler.middleware.ts` | Function named `errorHandler`, imported as `errorHandlerMiddleware` | Renamed export |
| `src/config/database.ts` | TS2345: `$on('error')` type incompatible in Prisma v5 | Refactored to typed `LogClient` with factory function |
| `src/middlewares/appErrorHandler.middleware.ts` | TS2774: `req.t` always defined (checked as boolean) | Removed boolean check, call directly |
| `src/middlewares/errorHandler.middleware.ts` | Same TS2774 | Same fix |
| `src/ocpp/handlers/index.ts` | TS6137: Cannot import `@types/ocpp.types` (conflicts with TS @types dir) | Changed to relative `../../types/ocpp.types` |
| `src/ocpp/messageParser.ts` | Same TS6137 | Changed to relative `../types/ocpp.types` |
| `src/ocpp/messageRouter.ts` | Same TS6137 | Changed to relative `../types/ocpp.types` |
| `src/ocpp/handlers/*.ts` (6 files) | TS2352: payload cast too narrow | Changed `as T` to `as unknown as T` |
| `src/ocpp/handlers/statusNotification.handler.ts` | TS2305: `ConnectorStatus`/`StationStatus` not in `@prisma/client` | Fixed by running `prisma generate` first |
| `src/services/auth.service.ts` | TS2305: `UserRole` not in `@prisma/client` | Fixed after `prisma generate` |
| `src/services/user.service.ts` | TS2305: `UserRole`/`UserStatus` not in `@prisma/client` | Fixed after `prisma generate` |
| `src/routes/index.ts` | TS7006: Implicit `any` on inline handler params | Added explicit `Request, Response, NextFunction` types + import |
| `src/routes/portal/cs/ops.routes.ts` etc. | TS7016: `uuid` missing types | Installed `@types/uuid` |

**Root cause of Prisma enum errors:** Prisma client had not been generated. Running `npx prisma generate` resolved all `@prisma/client` enum import errors.

### Build Result
```
npm run build → tsc -p tsconfig.build.json
Exit code: 0 (success)
```

---

## Runtime Errors Fixed

### 1. BullMQ: maxRetriesPerRequest must be null

**Error:** `BullMQ: Your redis options maxRetriesPerRequest must be null`

**Cause:** The shared `redis` ioredis instance had `maxRetriesPerRequest: 3`. BullMQ requires its connection to have `maxRetriesPerRequest: null`.

**Fix:** Added a separate `bullmqRedis` export in `src/config/redis.ts` with `maxRetriesPerRequest: null, enableReadyCheck: false`. Updated `src/jobs/index.ts` and `src/jobs/queues.ts` to use `bullmqRedis` instead of `redis`.

### 2. `req.t is not a function` on /health

**Error:** `TypeError: req.t is not a function` in `errorHandlerMiddleware`

**Cause:** `initI18n()` was never called before `createApp()` in `server.ts`. The i18next middleware was attached to the app but the i18next instance itself was not initialized (no locales loaded), so `req.t` was not set by the middleware.

**Fix 1:** Added `await initI18n()` call in `server.ts` bootstrap, before `createApp()`.

**Fix 2:** Added defensive guard in both error handlers: `const t = typeof req.t === 'function' ? req.t.bind(req) : (key: string) => key;` to prevent crashes if i18n is not yet initialized.

---

## Deployment Steps

1. Created remote directory: `/opt/pvpentech`
2. Transferred project archive via pscp (212KB tar.gz)
3. Ran `npm install` on remote
4. Created PostgreSQL database `pvpentech` (role `pvpentech` already existed)
5. Updated `.env` DATABASE_URL from `pvpentech_db` to `pvpentech`
6. Ran `npx prisma generate` + `npx prisma db push` — schema sync successful
7. Ran `npm run build` on remote — success
8. Started via PM2: `pm2 startOrRestart ecosystem.config.js --env production`
9. Fixed BullMQ redis error, redeployed updated dist
10. Fixed i18n initialization order, redeployed
11. Verified health endpoint: `GET /health → 200 OK`

---

## tsc: not found 에러가 날 경우
package.json:73 의 typescript 가 devDependencies 에 있는데, 다음 중 하나로 인해 설치 시 빠진 것:

  1. npm ci --production 또는 --omit=dev 로 설치
  2. NODE_ENV=production 이 export 된 셸에서 npm ci/npm install 실행 → npm 이 자동으로 devDependencies 생략
  3. 이전에 npm prune --production 으로 dev 패키지 제거됨

  .env 에 NODE_ENV=production 이 있고 같은 셸에서 source .env 했다면 2번이 가장 흔한 케이스.

  후속 — 운영 부하 줄이고 싶으면 (선택)

  빌드는 dev 패키지로 하고, 빌드 후 production 모드로 정리:

  NODE_ENV=development npm ci
  npm run build
  npm prune --omit=dev   # node_modules 에서 dev 패키지만 제거
  pm2 restart pvpentech-csms --update-env

  pm2 restart 가 끝나면 tsc 등 dev 도구는 사라지지만 dist/ 의 컴파일 결과는 그대로 동작합니다.

  ---

  ▎ 참고: 이 서버는 /opt/pvpentech 경로의 우분투 서버라 GCP VM (/home/jeong/pvpentech) 와는 별도 인스턴스 같습니다. 두 서버 모두 같은 패턴이라면, 향후
  ▎ aws_deploy.md / gcp_deployment_guide.md 의 의존성 설치 단계를 NODE_ENV=development npm ci 로 명시해두는 게 재발 방지에 좋습니다 — 원하시면 두 문서 동시 패치 PR
  ▎  으로 만들어드릴 수 있어요.


---

## Final State

| Component | Status |
|-----------|--------|
| PM2 process `pvpentech-csms` | online (stable) |
| HTTP server | Port 3000 |
| `/health` endpoint | `{"status":"ok","timestamp":"..."}` |
| PostgreSQL | Connected |
| Redis | Connected |
| OCPP WebSocket server | Attached and initialized |
| BullMQ workers | Started (`charge-goal`, `cleanup`) |
| Scheduled jobs | Initialized (session-timeout every 2min, cleanup at 03:00) |

### Warnings (non-blocking)
- Redis version 6.0.16 is below BullMQ's recommended 6.2.0. This produces log warnings but does not prevent operation. Upgrade Redis when possible.

---

## Server Connectivity

```
Health check: curl http://192.168.0.25:3000/health
OCPP WebSocket: ws://192.168.0.25:3000/ocpp/{stationId}
```

---

## Files Modified During Build Fix

- `src/config/i18n.ts` — added `i18n` alias export
- `src/config/database.ts` — Prisma v5 typed event client refactor
- `src/config/redis.ts` — added `bullmqRedis` with `maxRetriesPerRequest: null`
- `src/server.ts` — added `await initI18n()` before `createApp()`
- `src/middlewares/requestLogger.middleware.ts` — renamed export
- `src/middlewares/errorHandler.middleware.ts` — renamed export, fixed TS2774, added `req.t` guard
- `src/middlewares/appErrorHandler.middleware.ts` — fixed TS2774, added `req.t` guard
- `src/ocpp/handlers/index.ts` — relative import for ocpp.types
- `src/ocpp/messageParser.ts` — relative import for ocpp.types
- `src/ocpp/messageRouter.ts` — relative import for ocpp.types
- `src/ocpp/handlers/authorize.handler.ts` — `as unknown as` cast
- `src/ocpp/handlers/bootNotification.handler.ts` — `as unknown as` cast
- `src/ocpp/handlers/dataTransfer.handler.ts` — `as unknown as` cast
- `src/ocpp/handlers/meterValues.handler.ts` — `as unknown as` cast
- `src/ocpp/handlers/startTransaction.handler.ts` — `as unknown as` cast
- `src/ocpp/handlers/stopTransaction.handler.ts` — `as unknown as` cast
- `src/ocpp/handlers/statusNotification.handler.ts` — `as unknown as` cast
- `src/routes/index.ts` — added Request/Response/NextFunction imports, explicit param types
- `src/jobs/index.ts` — use `bullmqRedis`
- `src/jobs/queues.ts` — use `bullmqRedis`

---

## 2026-04-02 배포 내역

**배포 일시:** 2026-04-02T01:17 UTC  
**배포 방법:** pscp (PuTTY) 파일 전송 + 원격 빌드  
**배포자:** Claude Code (pvpentech-code-implementer)

### 변경 파일 목록

| 파일 | 유형 | 전송 결과 |
|------|------|-----------|
| `public/portal/cs/index.html` | 정적 파일 | 성공 |
| `locales/ko/station.json` | i18n 번역 | 성공 |
| `locales/en/station.json` | i18n 번역 | 성공 |
| `locales/vi/station.json` | i18n 번역 | 성공 |
| `src/jobs/processors/sessionTimeout.processor.ts` | TypeScript 소스 | 성공 |
| `src/jobs/processors/chargeGoal.processor.ts` | TypeScript 소스 | 성공 |
| `src/routes/portal/cs/ops.routes.ts` | TypeScript 소스 | 성공 |
| `src/services/notification.service.ts` | TypeScript 소스 | 성공 |
| `scripts/upgrade-redis.sh` | 스크립트 | 성공 |

### 빌드 결과

- 명령: `npm run build` (tsc -p tsconfig.build.json)
- 결과: **성공** (오류 없음)

### PM2 재시작

- 명령: `pm2 restart pvpentech-csms`
- 결과: **online** (pid: 4000831, uptime 4m, mem: 78.6mb)

### 헬스체크

- 엔드포인트: `http://localhost:3000/health`
- 응답: `{"status":"ok","timestamp":"2026-04-02T01:17:12.467Z"}`
- 결과: **정상**

### Redis 업그레이드 (선택적 작업)

- 이전 버전: Redis 6.0.16
- 업그레이드 후: **Redis 7.4.1**
- PPA: `ppa:redislabs/redis` (Ubuntu 22.04 jammy)
- 방법: `scripts/upgrade-redis.sh` 실행
- 결과: **성공** — redis-server 서비스 정상 동작

### 최종 상태 요약

| 항목 | 상태 |
|------|------|
| PM2 프로세스 | online |
| 헬스체크 | ok |
| Redis 버전 | 7.4.1 |
| 빌드 | 오류 없음 |
