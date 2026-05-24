# Phase 3-D: Cross-Schema Cleanup 완료 보고서

**날짜**: 2026-05-25  
**빌드 결과**: PASS (TypeScript 오류 0)

---

## 작업 범위

Portal → Core 및 Core → Portal 직접 cross-schema 접근을 모두 제거하고,
ChargeSessionProjection 기반 이벤트 소비 흐름을 완성.

---

## 수정 파일 목록

### Portal — 이벤트 핸들러 (D4)

| 파일 | 변경 내용 |
|------|-----------|
| `packages/portal/src/eventConsumer/handlers/transactionStarted.handler.ts` | Phase 2-C 스텁 → 완전 구현. `chargeSessionProjection.upsert`, siteId→partnerId 조회, SettlementSchedule 캐스트 |
| `packages/portal/src/eventConsumer/handlers/transactionStopped.handler.ts` | `chargeSessionProjection.updateMany` (Stopped 상태, meterStop, totalKwh, costVnd) + fallback create |
| `packages/portal/src/eventConsumer/handlers/meterValueUpdate.handler.ts` | `chargeSessionProjection.updateMany` (totalKwh 실시간 갱신) |

### Portal — 서비스 레이어

| 파일 | 변경 내용 |
|------|-----------|
| `packages/portal/src/services/charge.service.ts` | `prisma.transaction.*` 제거 → `chargeSessionProjection.updateMany` 전환; `startCharge` Projection 사전 생성 제거 |
| `packages/portal/src/services/payment.service.ts` | free/non-free 모드 `chargeSessionProjection.create(coreTransactionId: null)` 전면 제거; `createOrder` goalType→costVnd 전환 |
| `packages/portal/src/services/refund.service.ts` | `prisma.transaction` → `chargeSessionProjection.findFirst`; PaymentOrder status `'COMPLETED'` → `'PAID'` |
| `packages/portal/src/services/user.service.ts` | `prismaPortal` 전환; IdToken 조회 → `coreApiClient.listIdTokens` |
| `packages/portal/src/services/partner.service.ts` | `prismaPortal` 전환; Core IdToken 블록 → `coreApiClient` |
| `packages/portal/src/services/site.service.ts` | `coreApiClient.listStations` 필터로 chargingStation.count 대체 |
| `packages/portal/src/services/settlement.service.ts` | `coreApiClient.listStations` 필터로 chargingStation.findMany 대체 |
| `packages/portal/src/services/stats.service.ts` | `chargeSessionProjection` 집계; faultLog → `prismaLegacy` 임시 유지 (TODO Phase 4) |

### Portal — 레포지토리

| 파일 | 변경 내용 |
|------|-----------|
| `packages/portal/src/repositories/user.repository.ts` | `prismaPortal` 전환; `blockAllIdTokens` → `coreApiClient` |
| `packages/portal/src/repositories/site.repository.ts` | `prismaPortal` 전환 (Portal schema 전용, 로직 변경 없음) |

### Portal — 라우트

| 파일 | 변경 내용 |
|------|-----------|
| `packages/portal/src/routes/portal/customer/rfidCards.routes.ts` | `coreApiClient.listIdTokens/createIdToken/deleteIdToken` 전환 |
| `packages/portal/src/routes/portal/customer/dashboard.routes.ts` | `chargeSessionProjection.findMany` + `coreApiClient.listIdTokens` |
| `packages/portal/src/routes/portal/cs/sites.routes.ts` | `chargeSessionProjection.findMany({ where: { siteId } })` |
| `packages/portal/src/routes/portal/cs/partners.routes.ts` | `chargeSessionProjection.findMany({ where: { partnerId } })` |
| `packages/portal/src/routes/portal/cs/ops.routes.ts` | `coreApiClient.listStations` 필터로 resolveTargetStationIds 전환 |
| `packages/portal/src/routes/portal/partner/stations.routes.ts` | `coreApiClient.listStations` + Portal siteId 필터 |

### Portal — 미들웨어 / 잡

| 파일 | 변경 내용 |
|------|-----------|
| `packages/portal/src/middlewares/manufacturerAuth.middleware.ts` | `coreApiClient.listManufacturers` 전환; client-side channelId 필터 |
| `packages/portal/src/jobs/paymentTimeout.job.ts` | `chargeSessionProjection.updateMany(paymentStatus: 'failed')` |
| `packages/portal/src/jobs/processors/postChargeBilling.processor.ts` | `chargeSessionProjection.findFirst({ where: { coreTransactionId } })` |

### Core — cross-schema 참조 제거

| 파일 | 변경 내용 |
|------|-----------|
| `packages/core/src/services/station.service.ts` | `prismaLegacy` 제거; siteId 검증 스킵 (TODO Phase 4) |
| `packages/core/src/routes/portal/cs/faultLogs.routes.ts` | `prismaLegacy` 제거; partnerId 필터 warn+skip |
| `packages/core/src/routes/portal/cs/stations.routes.ts` | `prismaLegacy` 제거; filterOptions sites `{ id, name: null }` |

---

## 핵심 설계 결정

**ChargeSessionProjection 사전 생성 불가**  
`coreTransactionId Int @unique` (non-nullable) — Portal이 OCPP StartTransaction ID 없이 Projection을 생성하는 것은 스키마 위반. 올바른 흐름:

```
Portal: sessionId 생성 + PaymentOrder 생성
→ OCPP StartTransaction (Core 처리)
→ Core: Transaction 생성 + TransactionStarted 이벤트 발행
→ Portal Consumer: chargeSessionProjection.upsert (coreTransactionId 확보 후)
```

**잔존 deprecated prisma 사용 (의도적)**  
`stats.service.ts` `faultLog` 조회 1건 — Core schema 모델이나 Internal API 미구현. `TODO(Phase 4)` 주석 명시.

---

## 빌드 검증

```
> tsc -p tsconfig.build.json
(오류 없음 — exit 0)
```

---

## Phase 4 이관 항목

- `coreApiClient.listFaultLogs()` Internal API 엔드포인트 추가 → `stats.service.ts` prismaLegacy 제거
- `coreApiClient.listManufacturers({ channelId })` 파라미터 지원 → client-side 필터 제거
- Core Internal API: partnerId 기반 faultLog 필터 엔드포인트
- Core stations filterOptions: Portal ChargingSite name 조회 지원
