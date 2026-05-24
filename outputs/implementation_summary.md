# Pvpentech CSMS — Implementation Summary

**Date**: 2026-04-01  
**Version**: 1.0.0  
**Design Guide Version**: v1.0 (March 2026)

---

## Overview

Complete Node.js (TypeScript) implementation of the Pvpentech CSMS (Charge Station Management System), migrated from FastAPI/Django. All 12 design guide documents were consulted and implemented.

---

## Architecture

- **Runtime**: Node.js 20 LTS + TypeScript 5.x
- **Framework**: Express.js 4.x (single process, HTTP + WebSocket)
- **ORM**: Prisma 5.x + PostgreSQL
- **Queue**: BullMQ + ioredis (Redis)
- **Auth**: JWT (jsonwebtoken) + bcrypt
- **OCPP**: ws 8.x (OCPP 1.6, Security Profile 1 Basic Auth)
- **i18n**: i18next + i18next-http-middleware + i18next-fs-backend (ko/en/vi)
- **Logging**: Pino + pino-pretty
- **Validation**: Zod (env + request schemas)
- **Process Manager**: PM2 (single fork instance)

---

## Files Created

### Configuration
| File | Description |
|------|-------------|
| `package.json` | All dependencies and npm scripts |
| `tsconfig.json` | TypeScript config with path aliases |
| `tsconfig.build.json` | Build config (excludes scripts/tests) |
| `.env.example` | All required environment variables |
| `.gitignore` | Standard Node.js gitignore |
| `.eslintrc.json` | ESLint config (TypeScript) |
| `.prettierrc` | Prettier formatting config |
| `ecosystem.config.js` | PM2 single-instance config |
| `jest.config.ts` | Jest test config |
| `prisma/schema.prisma` | Full database schema (15 models) |

### Source Files (src/)

#### Config Layer
- `src/config/env.ts` — Zod-validated environment variables
- `src/config/logger.ts` — Pino logger with dev/prod modes
- `src/config/database.ts` — Prisma client singleton
- `src/config/redis.ts` — ioredis client (lazyConnect)
- `src/config/i18n.ts` — i18next init (ko/en/vi, 8 namespaces)
- `src/config/index.ts` — Barrel export

#### Types
- `src/types/ocpp.types.ts` — OCPP 1.6 message type definitions
- `src/types/common.types.ts` — Shared API response types
- `src/types/express.d.ts` — Express Request extension (user, t, i18n)

#### Utilities
- `src/utils/errors.ts` — AppError class hierarchy (7 error types)
- `src/utils/jwt.ts` — JWT sign/verify helpers
- `src/utils/password.ts` — bcrypt hash/compare helpers
- `src/utils/crypto.ts` — Cryptographic random string generation
- `src/utils/asyncHandler.ts` — Express async error wrapper
- `src/utils/auth.ts` — OCPP Basic Auth verifier, pagination helper

#### Middlewares
- `src/middlewares/auth.middleware.ts` — JWT Bearer token extraction + verification
- `src/middlewares/role.middleware.ts` — Role-based access control factory
- `src/middlewares/errorHandler.middleware.ts` — Global error handler (portal format)
- `src/middlewares/appErrorHandler.middleware.ts` — Mobile error handler `{ detail }`
- `src/middlewares/userLanguage.middleware.ts` — DB language fallback
- `src/middlewares/requestLogger.middleware.ts` — Request/response logging
- `src/middlewares/rateLimiter.middleware.ts` — API, login, provision rate limiters

#### OCPP Module
- `src/ocpp/messageParser.ts` — OCPP message parse/serialize
- `src/ocpp/connectionManager.ts` — WebSocket registry (Map<stationId, WS>)
- `src/ocpp/pendingRequests.ts` — Promise-based OCPP response awaiter (30s timeout)
- `src/ocpp/schemaValidator.ts` — Required-field validation per action
- `src/ocpp/messageRouter.ts` — Routes Call/CallResult/CallError to handlers
- `src/ocpp/server.ts` — WebSocket server (Basic Auth, /ocpp path)
- `src/ocpp/handlers/bootNotification.handler.ts`
- `src/ocpp/handlers/heartbeat.handler.ts`
- `src/ocpp/handlers/statusNotification.handler.ts`
- `src/ocpp/handlers/startTransaction.handler.ts`
- `src/ocpp/handlers/stopTransaction.handler.ts`
- `src/ocpp/handlers/authorize.handler.ts`
- `src/ocpp/handlers/meterValues.handler.ts`
- `src/ocpp/handlers/dataTransfer.handler.ts`
- `src/ocpp/handlers/index.ts` — Handler map
- `src/ocpp/commands/remoteStartTransaction.command.ts`
- `src/ocpp/commands/remoteStopTransaction.command.ts`
- `src/ocpp/commands/reset.command.ts`
- `src/ocpp/commands/changeAvailability.command.ts`
- `src/ocpp/commands/index.ts`

#### Services
- `src/services/auth.service.ts` — Login (mobile 24h / portal 8h), register
- `src/services/charge.service.ts` — startCharge, getStatus, stopCharge
- `src/services/station.service.ts` — Station CRUD + fault logs + reset
- `src/services/user.service.ts` — User CRUD + cards + token management
- `src/services/partner.service.ts` — Partner lifecycle + settlements
- `src/services/site.service.ts` — Charging site CRUD
- `src/services/session.service.ts` — Transaction/session queries
- `src/services/stats.service.ts` — Dashboard KPIs + partner stats
- `src/services/provision.service.ts` — Charger provisioning (EN+7digit IDs)
- `src/services/ocppMessage.service.ts` — OCPP message log CRUD
- `src/services/faultLog.service.ts` — Fault log queries and resolution

#### Controllers
- `src/controllers/auth.controller.ts`
- `src/controllers/charge.controller.ts`
- `src/controllers/station.controller.ts`
- `src/controllers/user.controller.ts`
- `src/controllers/partner.controller.ts`
- `src/controllers/site.controller.ts`
- `src/controllers/session.controller.ts`
- `src/controllers/stats.controller.ts`
- `src/controllers/provision.controller.ts`

#### Routes
- `src/routes/auth.routes.ts`
- `src/routes/charge.routes.ts`
- `src/routes/portal/cs/dashboard.routes.ts`
- `src/routes/portal/cs/partners.routes.ts`
- `src/routes/portal/cs/sites.routes.ts`
- `src/routes/portal/cs/stations.routes.ts`
- `src/routes/portal/cs/users.routes.ts`
- `src/routes/portal/cs/idTokens.routes.ts`
- `src/routes/portal/cs/settlements.routes.ts`
- `src/routes/portal/cs/ops.routes.ts`
- `src/routes/portal/cs/provisioning.routes.ts`
- `src/routes/portal/partner/dashboard.routes.ts`
- `src/routes/portal/partner/sites.routes.ts`
- `src/routes/portal/partner/stations.routes.ts`
- `src/routes/portal/partner/stats.routes.ts`
- `src/routes/portal/partner/settlements.routes.ts`
- `src/routes/portal/partner/bankAccount.routes.ts`
- `src/routes/portal/customer/dashboard.routes.ts`
- `src/routes/portal/customer/history.routes.ts`
- `src/routes/portal/customer/rfidCards.routes.ts`
- `src/routes/portal/customer/paymentCards.routes.ts`
- `src/routes/portal/customer/profile.routes.ts`
- `src/routes/index.ts` — Master router aggregating all routes

#### Jobs
- `src/jobs/queues.ts` — BullMQ queue definitions
- `src/jobs/processors/chargeGoal.processor.ts` — Goal-based auto-stop
- `src/jobs/processors/sessionTimeout.processor.ts` — Pending session timeout (5min)
- `src/jobs/processors/ocppLogCleanup.processor.ts` — 30-day log retention
- `src/jobs/schedulers/daily.scheduler.ts` — Repeatable job registration
- `src/jobs/index.ts` — Worker initialization + graceful stop

#### Application Entry Points
- `src/app.ts` — Express app factory with all middleware
- `src/server.ts` — HTTP server + WebSocket server + graceful shutdown

### Locales (i18n Translation Files)
All 24 JSON files created for 8 namespaces × 3 languages:

| Namespace | ko | en | vi |
|-----------|----|----|-----|
| common | ✓ | ✓ | ✓ |
| error | ✓ | ✓ | ✓ |
| auth | ✓ | ✓ | ✓ |
| charge | ✓ | ✓ | ✓ |
| station | ✓ | ✓ | ✓ |
| user | ✓ | ✓ | ✓ |
| partner | ✓ | ✓ | ✓ |
| notification | ✓ | ✓ | ✓ |

### Scripts
- `scripts/seed.ts` — CsmsVariable seed + StationIdSequence init
- `scripts/validateTranslations.ts` — 3-language translation consistency check
- `scripts/deploy.sh` — rsync + PM2 deployment to Ubuntu server

---

## Key Design Decisions

### OCPP Connection Management
- Single in-memory `Map<stationId, WebSocket>` (ConnectionManager)
- Duplicate connection handled by terminating the existing connection
- PM2 single-fork instance to avoid shared state issues

### Error Handling Separation
- **Mobile API** (`/api/charge/*`): Returns `{ detail: "message" }` for Android app compatibility
- **Portal API** (`/api/portal/*`): Returns `{ success: false, error: { code, message } }`
- Error `code` is always a fixed English string; `message` is i18n-translated via `req.t()`

### Provisioning (Charger Registration)
- Serial number whitelist checked before provisioning
- Station IDs generated as `EN` + 7-digit sequence starting at `EN1000001`
- Atomic DB sequence via `StationIdSequence` table with increment
- OCPP Basic Auth password bcrypt-hashed and stored in `ChargingStation.passwordHash`

### i18n Integration
- Language detection: Accept-Language header → querystring `?lang=` → DB user.language → default `ko`
- Error classes carry `messageKey`; global error handler calls `req.t(messageKey)` at response time
- Missing translation keys logged as `warn` via `missingKeyHandler`

### Session Lifecycle
- `Pending` → (RemoteStart + vehicle connect) → `Active` → (StopTransaction) → `Stopped`
- Pending sessions older than 5 minutes auto-transitioned to `Failed` by BullMQ job
- `getStatus` returns `null` for `Stopped`/`Failed` sessions (app treats as completion)

---

## API Endpoints Summary

### Mobile App (`/api/*`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/login` | Mobile login |
| POST | `/api/logout` | Logout |
| POST | `/api/charge/start` | Start charging session |
| GET | `/api/charge/status` | Get session status |
| POST | `/api/charge/stop` | Stop charging session |
| POST | `/api/provision` | Charger self-provisioning |

### CS Portal (`/api/portal/cs/*`)
- Dashboard, Partners (CRUD + approve/reject/settle), Sites, Stations, Users, IdTokens, Settlements, Ops (variables, OCPP messages, remote commands), Provisioning

### Partner Portal (`/api/portal/partner/*`)
- Dashboard, Sites (read), Stations (read + online status), Stats, Settlements, Bank Account

### Customer Portal (`/api/portal/customer/*`)
- Dashboard (charging history), History, RFID Cards, Payment Cards, Profile

---

## Database Models (Prisma)

15 models in `prisma/schema.prisma`:
`ChargingStation`, `Connector`, `ChargingSite`, `User`, `PartnerProfile`, `PaymentCard`, `IdToken`, `Transaction`, `MeterValue`, `DeviceVariable`, `OcppMessage`, `FaultLog`, `ChargerProvisioning`, `StationIdSequence`, `CsmsVariable`, `Settlement`

---

## Environment Variables Required

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
JWT_SECRET=<min 32 chars>
JWT_EXPIRES_IN=24h
OCPP_RESPONSE_TIMEOUT_MS=30000
OCPP_HEARTBEAT_INTERVAL_SEC=60
DEFAULT_UNIT_PRICE_KRW=250
LOG_LEVEL=info
LOG_PRETTY=false
CORS_ORIGIN=https://pvpentech.kr
```

---

## Deployment

```bash
# Deploy to 192.168.0.25
chmod +x scripts/deploy.sh
./scripts/deploy.sh

# On remote server
pm2 status
pm2 logs pvpentech-csms
```

---

## Design Guide Coverage

| Guide | Status |
|-------|--------|
| 01_system_architecture.md | Implemented |
| 02_project_directory_structure.md | Implemented |
| 03_ocpp_websocket_handler.md | Implemented |
| 04_database_schema.md | Implemented (Prisma schema) |
| 05_rest_api_design.md | Implemented |
| 06_auth_design.md | Implemented |
| 07_error_handling.md | Implemented |
| 08_environment_and_deployment.md | Implemented |
| 09_charge_session_flow.md | Implemented |
| 10_i18n_design.md | Implemented (24 locale files) |
| 11_portal_menu_structure.md | Implemented (all portal routes) |
| 12_charger_provisioning.md | Implemented |
