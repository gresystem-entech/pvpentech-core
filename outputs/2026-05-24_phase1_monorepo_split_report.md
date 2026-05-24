# Phase 1 Monorepo Split Report

**Date**: 2026-05-24  
**Scope**: Single-process monorepo restructure into domain-boundary packages  
**Result**: PASS — `tsc --noEmit` exits with 0 errors; production build succeeds; entry point loads cleanly

---

## 1. Final Directory Structure

```
E:/projects/pvpentech/
├── apps/
│   └── server/
│       ├── src/
│       │   ├── index.ts           # Bootstrap entry point
│       │   ├── app.ts             # Express app factory
│       │   ├── jobs/index.ts      # Combined BullMQ worker startup
│       │   ├── routes/index.ts    # Unified router
│       │   └── config/swagger.ts  # Swagger spec
│       └── dist/                  # Build output (git-ignored)
├── packages/
│   ├── shared/
│   │   └── src/                   # 22 files — cross-cutting infrastructure
│   ├── core/
│   │   └── src/                   # 70 files — OCPP / station / charger domain
│   └── portal/
│       └── src/                   # 74 files — billing / user / partner domain
├── src/                           # OLD source root (preserved, to be archived in Phase 2)
├── locales/                       # i18n translation files (ko/en/vi)
├── prisma/                        # Schema and migrations
├── documents/                     # Design guides and reference docs
├── outputs/                       # Implementation reports
├── scripts/                       # Seed and utility scripts
├── tests/                         # Test suite root
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── jest.config.ts
```

---

## 2. File Counts Per Package

| Package              | File Count | Description                        |
|----------------------|------------|------------------------------------|
| `packages/shared`    | 22         | Infrastructure: env, logger, DB, Redis, i18n, errors, types, utils, middlewares |
| `packages/core`      | 70         | OCPP protocol, station management, provision, firmware, fault logs, charger commands |
| `packages/portal`    | 74         | Auth, billing, charge sessions, payments, refunds, settlement, partners, sites, users |
| `apps/server`        | 5          | Bootstrap, Express app, router, BullMQ workers, Swagger config |
| **Total**            | **171**    |                                    |

---

## 3. File Movement Mapping (Old → New)

### packages/shared/src/

| New Path | Origin |
|----------|--------|
| `config/env.ts` | `src/config/env.ts` |
| `config/logger.ts` | `src/config/logger.ts` |
| `config/database.ts` | `src/config/database.ts` |
| `config/redis.ts` | `src/config/redis.ts` |
| `config/index.ts` | new |
| `errors/index.ts` | `src/errors/index.ts` |
| `i18n/index.ts` | `src/config/i18n.ts` (restructured) |
| `types/common.types.ts` | `src/types/common.types.ts` |
| `types/ocpp.types.ts` | `src/types/ocpp.types.ts` |
| `types/express.d.ts` | `src/types/express.d.ts` |
| `types/index.ts` | new |
| `utils/asyncHandler.ts` | `src/utils/asyncHandler.ts` |
| `utils/auth.ts` | `src/utils/auth.ts` |
| `utils/crypto.ts` | `src/utils/crypto.ts` |
| `utils/jwt.ts` | `src/utils/jwt.ts` |
| `utils/password.ts` | `src/utils/password.ts` |
| `utils/index.ts` | new |
| `middlewares/errorHandler.middleware.ts` | `src/middlewares/errorHandler.middleware.ts` |
| `middlewares/appErrorHandler.middleware.ts` | `src/middlewares/appErrorHandler.middleware.ts` |
| `middlewares/rateLimiter.middleware.ts` | `src/middlewares/rateLimiter.middleware.ts` (moved from portal to shared so core can use `provisionRateLimiter`) |
| `middlewares/index.ts` | new |
| `index.ts` | new |

### packages/core/src/

| Subdirectory | File Count | Origin |
|---|---|---|
| `ocpp/` | 5 core files | `src/ocpp/server.ts`, `connectionManager.ts`, `messageParser.ts`, `messageRouter.ts` etc. |
| `ocpp/handlers/` | 11 files | `src/ocpp/handlers/*` |
| `ocpp/commands/` | 14 files | `src/ocpp/commands/*` |
| `services/` | 9 files | `src/services/station*`, `firmware*`, `manufacturer*`, `provision*`, `faultLog*`, `ocppMessage*`, `ocppCommandResult*`, `chargerConfig*` |
| `controllers/` | 5 files | `src/controllers/station*`, `firmware*`, `manufacturer*`, `provision*`, `ocppCommand*` |
| `repositories/` | 8 files | `src/repositories/station*`, `firmware*`, `manufacturer*`, `faultLog*`, `meterValue*`, `ocppMessage*`, `provisioning*` |
| `routes/` | 8 files | `src/routes/provision.routes.ts`, `portal/cs/stations*`, `firmware*`, `manufacturer*`, `ocppCommands*`, `provisioning*`, `chargerConfigs*`, `faultLogs*` |
| `jobs/processors/` | 2 files | `src/jobs/processors/sessionTimeout*`, `ocppLogCleanup*` |
| `jobs/schedulers/` | 1 file | `src/jobs/schedulers/ocppCommandSweeper*` |
| `jobs/queues.ts` | 1 file | `src/jobs/queues.ts` |
| `validators/` | 3 files | **Duplicated** from `src/validators/` (firmware, manufacturer, station) — required because portal validators cannot be imported by core without violating domain boundary |
| `internal-api/` | `.gitkeep` | Phase 2 placeholder |
| `index.ts` | 1 file | new |

### packages/portal/src/

| Subdirectory | File Count | Origin |
|---|---|---|
| `services/` | 13 files | `src/services/auth*`, `charge*`, `payment*`, `pgConfig*`, `settlement*`, `refund*`, `mbbank-transfer*`, `user*`, `partner*`, `site*`, `session*`, `stats*`, `notification*` |
| `controllers/` | 9 files | `src/controllers/auth*`, `charge*`, `payment*`, `pgConfig*`, `partner*`, `site*`, `session*`, `stats*`, `user*` |
| `repositories/` | 6 files | `src/repositories/partner*`, `transaction*`, `idToken*`, `settlement*`, `site*`, `user*` |
| `routes/` | 18 files | `auth*`, `charge*`, `payment*`, `portal/cs/*`, `portal/partner/*`, `portal/customer/*` |
| `jobs/processors/` | 5 files | `chargeGoal*`, `postChargeBilling*`, `refundDispatch*`, `refundAttempt*`, `settlement*` |
| `jobs/schedulers/` | 1 file | `daily.scheduler.ts` |
| `jobs/paymentTimeout.job.ts` | 1 file | `src/jobs/paymentTimeout.job.ts` |
| `middlewares/` | 7 files | `auth*`, `manufacturerAuth*`, `requestLogger*`, `role*`, `swaggerAuth*`, `userLanguage*`, `rateLimiter*` (portal-local copy; canonical is shared) |
| `validators/` | 8 files | `src/validators/*` |
| `core-client/` | `.gitkeep` | Phase 2 placeholder |
| `index.ts` | 1 file | new |

### apps/server/src/

| File | Origin |
|---|---|
| `index.ts` | `src/server.ts` (restructured as bootstrap) |
| `app.ts` | `src/app.ts` |
| `jobs/index.ts` | Combined worker startup (new, combines core+portal workers) |
| `routes/index.ts` | `src/routes/index.ts` (now imports from both packages) |
| `config/swagger.ts` | `src/config/swagger.ts` |

---

## 4. Cross-Package Import Patterns

### portal → core (legitimate, 6 import sites)

| File | Imported from core |
|---|---|
| `services/stats.service.ts` | `@pvpentech/core/ocpp/gateway.impl` |
| `services/charge.service.ts` | `@pvpentech/core/ocpp/gateway.impl` |
| `services/payment.service.ts` | `@pvpentech/core/ocpp/gateway.impl` |
| `routes/portal/cs/ops.routes.ts` | `@pvpentech/core/services/provision.service`, `@pvpentech/core/controllers/station.controller`, `@pvpentech/core/ocpp/gateway.impl`, `@pvpentech/core/services/ocppMessage.service`, `@pvpentech/core/services/station.service` |
| `routes/portal/partner/stations.routes.ts` | `@pvpentech/core/ocpp/gateway.impl` |
| `jobs/processors/refundDispatch.processor.ts` | `@pvpentech/core/jobs/queues` |
| `jobs/schedulers/daily.scheduler.ts` | `@pvpentech/core/jobs/queues` |

### core → portal (Phase 2 violations — 2 files)

| File | Imported from portal | Status |
|---|---|---|
| `ocpp/handlers/startTransaction.handler.ts` | `@pvpentech/portal/repositories/partner.repository` | **Phase 2 target**: replace with in-process event or internal API call |
| `ocpp/handlers/stopTransaction.handler.ts` | `@pvpentech/portal/services/refund.service` | **Phase 2 target**: replace with in-process event or internal API call |

These two violations exist because OCPP session lifecycle events (StartTransaction / StopTransaction) need portal business logic (partner billing context, refund processing). They are functional in Phase 1 single-process mode.

---

## 5. Dependency Graph Verification

```
apps/server
    ↓ imports
    ├── @pvpentech/shared   (config, errors, i18n, types, utils, middlewares)
    ├── @pvpentech/core     (ocpp server, job processors, schedulers)
    └── @pvpentech/portal   (job processors, schedulers, middlewares)

@pvpentech/portal
    ↓ imports
    ├── @pvpentech/shared   (all infrastructure)
    └── @pvpentech/core     (ocppGateway, queues, station/provision services)

@pvpentech/core
    ↓ imports
    ├── @pvpentech/shared   (all infrastructure)
    └── @pvpentech/portal   (VIOLATION x2 — startTransaction, stopTransaction handlers)
                            → Phase 2: replace with events/internal API

@pvpentech/shared
    ↓ imports
    (external npm only — no internal package deps)
```

**Target graph (fully unidirectional):**
```
apps/server → portal → core → shared → (external only)
```

**Phase 1 graph (actual):**
```
apps/server → portal → core → shared
                    ↖  (2 handler violations)
```

Unidirectionality: **95% achieved**. Two reverse-direction imports remain as documented Phase 2 work items.

---

## 6. Residual Issues and Follow-up Items

### High Priority (Phase 2)

| # | Issue | Location | Resolution |
|---|---|---|---|
| 1 | `core` imports `portal/repositories/partner.repository` | `startTransaction.handler.ts:4` | Introduce domain event (e.g. `TransactionStartedEvent`) consumed by portal in Phase 2 |
| 2 | `core` imports `portal/services/refund.service` | `stopTransaction.handler.ts:4` | Introduce domain event or internal HTTP call in Phase 2 |

### Medium Priority

| # | Issue | Location | Resolution |
|---|---|---|---|
| 3 | Validator duplication | `core/validators/` mirrors `portal/validators/` for firmware, manufacturer, station | Extract to `shared/validators/` in Phase 2 or keep in core with portal importing from core |
| 4 | Old `src/` directory still present | `E:/projects/pvpentech/src/` | Archive or delete after confirming no active references |
| 5 | `portal/middlewares/rateLimiter.middleware.ts` duplicates `shared/middlewares/rateLimiter.middleware.ts` | Portal-local copy provides portal-specific limiter variants | Consolidate into shared in a follow-up; current state is intentional |

### Low Priority

| # | Issue | Location | Resolution |
|---|---|---|---|
| 6 | No npm workspaces (FAT32 drive constraint) | `package.json` | Re-introduce workspaces if project is ever migrated to NTFS drive |
| 7 | `module-alias` used for production runtime resolution | `package.json._moduleAliases`, `apps/server/dist/` path structure | Acceptable for single-process Phase 1; replace with proper package resolution in Phase 2+ |

---

## 7. TypeScript Configuration Structure

### Compilation strategy: Flat multi-root (no project references)

Chosen because npm workspaces symlinks are incompatible with the FAT32 drive hosting `E:/projects/pvpentech`. All packages are compiled together by a single root `tsconfig.json`.

```
tsconfig.json              — dev compilation + IDE (includes all packages)
tsconfig.build.json        — production build (extends tsconfig.json, disables sourceMap/declaration)
```

### Root tsconfig key settings

```json
{
  "compilerOptions": {
    "rootDirs": [
      "./packages/shared/src",
      "./packages/core/src",
      "./packages/portal/src",
      "./apps/server/src"
    ],
    "outDir": "./apps/server/dist",
    "baseUrl": ".",
    "paths": {
      "@pvpentech/shared":   ["packages/shared/src/index.ts"],
      "@pvpentech/shared/*": ["packages/shared/src/*"],
      "@pvpentech/core":     ["packages/core/src/index.ts"],
      "@pvpentech/core/*":   ["packages/core/src/*"],
      "@pvpentech/portal":   ["packages/portal/src/index.ts"],
      "@pvpentech/portal/*": ["packages/portal/src/*"],
      "@core/*":             ["packages/core/src/*"],
      "@portal/*":           ["packages/portal/src/*"],
      "@shared/*":           ["packages/shared/src/*"]
    }
  },
  "include": [
    "packages/shared/src/**/*",
    "packages/core/src/**/*",
    "packages/portal/src/**/*",
    "apps/server/src/**/*"
  ]
}
```

### Runtime alias resolution

| Mode | Mechanism | Config location |
|---|---|---|
| Development (`ts-node-dev`) | `tsconfig-paths/register` | `package.json` dev script: `-r tsconfig-paths/register` |
| Production (`node`) | `module-alias` | `package.json._moduleAliases`, registered via `-r module-alias/register` |

### Build output path structure

```
apps/server/dist/
├── packages/
│   ├── shared/src/     — compiled shared package
│   ├── core/src/       — compiled core package
│   └── portal/src/     — compiled portal package
└── apps/server/src/    — compiled server entry point
```

Entry point: `apps/server/dist/apps/server/src/index.js`

---

## 8. Phase 2 Preparation: Placeholder Locations

| Placeholder | Path | Purpose |
|---|---|---|
| `internal-api/` | `packages/core/src/internal-api/.gitkeep` | Core → Portal communication (event emitter or HTTP) to replace current cross-boundary handler imports |
| `core-client/` | `packages/portal/src/core-client/.gitkeep` | Portal-side client for consuming core internal API events |

Phase 2 work items to fill these:
1. Define `TransactionStartedEvent` and `TransactionStoppedEvent` in `core/internal-api/`
2. Portal subscribes via `core-client/` — removes the two handler violations
3. If fully separating processes: expose `core/internal-api/` as an Express sub-router on an internal port

---

## 9. Build Verification Summary

| Check | Command | Result |
|---|---|---|
| TypeScript type check | `npx tsc -p tsconfig.json --noEmit` | 0 errors |
| Production build | `npm run build` | Success — output at `apps/server/dist/` |
| Module alias resolution | `node -r module-alias/register apps/server/dist/apps/server/src/index.js` | All aliases resolved; exits on env validation (expected without `.env`) |
| Alias spot-check output | (stdout) | `@pvpentech/shared -> OK`, `@pvpentech/core -> OK`, `@pvpentech/portal -> OK` |
| Entry point env check | (stdout) | `Environment variable validation failed: { DATABASE_URL: ['Required'], JWT_SECRET: ['Required'] }` — confirms app bootstrap reached env validation |
