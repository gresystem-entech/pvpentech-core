# Pvpentech CSMS Core

OCPP 1.6 WebSocket 게이트웨이 + 충전기 관리 + Internal API 서버.

## 구성

| 경로 | 역할 |
|------|------|
| `packages/core/` | OCPP 핸들러/명령, 충전기 관리, Outbox writer/relay, Internal API |
| `packages/shared/` | 공통 타입/유틸/config (DB, Redis, logger, i18n 등) |
| `apps/core-server/` | Core 진입점 (기본 port 3001) |
| `prisma/` | 전체 스키마 + 마이그레이션 (Core + Portal 공용) |

## 실행

```bash
# 의존성 설치
npm install

# Prisma Client 생성 (환경변수 DATABASE_URL 필요)
npx prisma generate

# 개발 서버 (ts-node-dev, 파일 변경 시 자동 재시작)
npm run dev

# 프로덕션 빌드
npm run build

# 빌드된 서버 실행
npm run start
```

## 환경변수

`.env.example`을 복사하여 `.env`로 사용합니다.

| 변수 | 설명 | 필수 |
|------|------|------|
| `CORE_PORT` | Core HTTP 서버 포트 (기본 3001) | O |
| `DATABASE_URL` | PostgreSQL 연결 문자열 | O |
| `REDIS_HOST` | Redis 호스트 | O |
| `REDIS_PORT` | Redis 포트 (기본 6379) | O |
| `CSMS_INTERNAL_API_TOKEN` | Portal → Core 서비스 간 Bearer 토큰 (32자 이상) | O |
| `OCPP_RESPONSE_TIMEOUT_MS` | OCPP 응답 대기 최대 시간 ms (기본 30000) | - |
| `OCPP_HEARTBEAT_INTERVAL_SEC` | Heartbeat 주기 초 (기본 60) | - |
| `CSMS_SERVER_URL` | 충전기 프로비저닝용 WebSocket URL | O |
| `LOG_LEVEL` | 로그 레벨 (info/debug/warn/error) | - |
| `CORS_ORIGIN` | 허용 CORS 오리진 (콤마 구분) | O |

## 운영

### pm2

```bash
pm2 start ecosystem.config.js --env production
pm2 logs pvpentech-core
pm2 reload pvpentech-core
```

### DB 마이그레이션

마이그레이션은 수동 적용합니다. 운영자가 SQL을 직접 실행하거나 prisma CLI 사용:

```bash
# 개발 환경
npx prisma migrate dev

# 운영 환경 (CI/CD 없이 수동 적용)
npx prisma migrate deploy
```

> **주의**: `prisma/schema.prisma`는 pvpentech-portal 리포와 **동기화** 유지 필요.
> 스키마 변경 시 두 리포 모두 업데이트하고 마이그레이션을 동기화해야 합니다.
> 자세한 내용: `docs/sync.md`

## Portal과의 통신 구조

```
Core Server (port 3001)
  ├── OCPP WebSocket  ← 충전기 연결
  ├── Internal API (/api/internal/v1/)  ← Portal이 호출
  ├── Outbox → Redis Stream  → Portal Consumer
  └── BullMQ 큐 (charge-goal, cleanup 등)
```

- Portal은 Core에게 **Internal API**로 명령을 내리고, Core는 **Redis Stream**으로 이벤트를 Portal에 발행합니다.
- 두 서비스는 **같은 PostgreSQL 인스턴스** (다른 논리 스키마 영역)와 **같은 Redis**를 공유합니다.

## 관련 리포

- **pvpentech-portal**: 모바일 API / CS·Partner·Customer 포털 / 결제·정산 처리
