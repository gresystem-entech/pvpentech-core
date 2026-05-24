# Phase 2-A 구현 보고서: Outbox 패턴 + Redis Stream 인프라

**작성일**: 2026-05-24  
**범위**: Phase 2-A — Outbox 인프라, Redis Stream Publisher/Consumer 기반 구축  
**설계 참조**: `outputs/2026-05-21_system_split_design_review.md` 섹션 5-3 (Saga + Outbox), 섹션 6-2 (이벤트 카탈로그)  

---

## 1. 추가된 모델/모듈 요약

### 1-1. Prisma 모델 (prisma/schema.prisma)

| 모델 | 테이블 | 목적 |
|------|--------|------|
| `OutboxEvent` | `outbox_event` | 비즈니스 트랜잭션 내 이벤트 기록. `publishedAt IS NULL` 조건으로 미발행 이벤트 릴레이 |
| `ConsumedEvent` | `consumed_event` | Portal Consumer의 `eventId` 기반 idempotency 중복 방지 |

**OutboxEvent 주요 필드**:
- `eventId` (UUID v4, UNIQUE) — Consumer 중복 처리 방지 키
- `publishedAt` (nullable) — null이면 미발행 대기 상태. 인덱스 적용
- `attempts` / `lastError` — 실패 재시도 추적. MAX_ATTEMPTS(10) 도달 시 DLQ 이동

### 1-2. 신규 소스 파일

| 파일 | 패키지 | 역할 |
|------|--------|------|
| `packages/shared/src/types/events.ts` | shared | CsmsEventType union, 이벤트 카탈로그 8종 payload 타입 |
| `packages/core/src/outbox/outboxWriter.ts` | core | Prisma tx 내 OutboxEvent 기록 함수 (`writeOutbox`) |
| `packages/core/src/outbox/streamPublisher.ts` | core | ioredis XADD 기반 Redis Stream 발행 (`publishEventToStream`, `moveToDeadLetter`) |
| `packages/core/src/outbox/outboxRelay.ts` | core | 2초 주기 폴링 릴레이 (`startOutboxRelay`, `stopOutboxRelay`) |
| `packages/core/src/outbox/index.ts` | core | outbox 모듈 공개 API |
| `packages/portal/src/eventConsumer/streamConsumer.ts` | portal | Consumer Group 기반 XREADGROUP 소비 루프 (`startConsumer`, `onEvent`) |
| `packages/portal/src/eventConsumer/idempotency.ts` | portal | `alreadyConsumed` / `markConsumed` — DB 중복 방지 |
| `packages/portal/src/eventConsumer/index.ts` | portal | eventConsumer 모듈 공개 API |

---

## 2. 이벤트 발행 흐름도

```
비즈니스 로직 (Core)
  │
  ├─ prisma.$transaction(async (tx) => {
  │    await tx.transaction.update(...)      // 비즈니스 변경
  │    await writeOutbox(tx, {               // 동일 tx — 원자성 보장
  │      eventType: 'TransactionStopped',
  │      payload: { ... }
  │    })
  │  })
  │
OutboxRelay (2초 주기 폴링)
  │
  ├─ findMany({ publishedAt: null, attempts: { lt: 10 } })
  ├─ publishEventToStream(event)
  │    XADD csms:core:events MAXLEN ~ 1000000 * ...fields
  ├─ 성공: outboxEvent.update({ publishedAt: now() })
  └─ 실패 (attempts < 10): attempts+1, lastError 갱신 → 다음 틱 재시도
       실패 (attempts >= 10): moveToDeadLetter → csms:core:events:dlq
                               publishedAt = now() (재시도 제외)

Redis Stream: csms:core:events
  │
  └─ StreamConsumer (Portal)
       XREADGROUP GROUP csms-portal portal-instance-{pid}
         COUNT 32 BLOCK 5000 STREAMS csms:core:events >
       │
       ├─ alreadyConsumed(eventId) → true: skip
       ├─ handler(event) 실행
       ├─ 성공: XACK + markConsumed(eventId)
       └─ 실패: ACK 생략 → PEL에 남아 재처리 (at-least-once)
```

---

## 3. 마이그레이션 SQL 요약

파일: `prisma/migrations/20260524000001_add_outbox_consumed_event/migration.sql`

- `outbox_event` 테이블 생성 (BIGSERIAL PK, eventId UNIQUE, publishedAt/eventType 인덱스)
- `consumed_event` 테이블 생성 (eventId PK, processedAt/eventType 인덱스)

**운영 적용 시 주의사항**:
- `prisma migrate deploy` 명령으로 적용 (데이터 마이그레이션 불필요 — 순수 신규 테이블)
- 기존 테이블 변경 없음 — 무중단 적용 가능
- 적용 전 DB 백업 권장

---

## 4. 검증 결과

| 항목 | 결과 |
|------|------|
| `npm run build` (TypeScript 컴파일) | 오류 0건 통과 |
| `npx prisma format` | 포맷 통과 (69ms) |
| `npx prisma generate` | Prisma Client 재생성 성공 (OutboxEvent, ConsumedEvent 포함) |
| 마이그레이션 파일 생성 | 완료 (운영 DB 미적용) |

---

## 5. Phase 2-B/C/D/E 연결

| Phase | 이 구현과의 연결 |
|-------|----------------|
| **2-B**: Core OCPP 핸들러 이벤트 발행 | `startTransaction.handler.ts`, `stopTransaction.handler.ts` 내 `writeOutbox(tx, ...)` 호출 추가. OutboxRelay가 자동 릴레이 |
| **2-C**: Portal Consumer 핸들러 구현 | `onEvent('TransactionStopped', handler)` 등록. `alreadyConsumed` / `markConsumed` 조합으로 idempotency 처리 |
| **2-D**: charge.service → OCPP 어댑터 분리 | `sendRemoteStartTransaction` HTTP 어댑터 전환. Core가 `TransactionStarted` 이벤트 발행으로 Portal에 세션 정보 전달 |
| **2-E**: Core/Portal 진입점 분리 | `startOutboxRelay()`는 core-server 진입점으로, `startConsumer()`는 portal-server 진입점으로 이동. 현재 통합 진입점에서 분리 |

---

## 6. 설계 결정 사항

- **단일 인스턴스(D-2)**: `running` 플래그로 동일 틱 내 중복 실행 방지. 분산락 미도입
- **DLQ 전략**: MAX_ATTEMPTS(10) 초과 시 `csms:core:events:dlq` Stream으로 이동 + `publishedAt` 설정으로 재시도 제외
- **Consumer Group**: `$` (현재 이후 메시지만 소비) — 기존 미처리 메시지가 없는 초기 배포 전제. 이전 메시지 소비가 필요한 경우 `0` 으로 변경 가능
- **BLOCK 5000ms**: Redis 연결 유지 최적화. stopped 플래그 확인 주기가 최대 5초임
