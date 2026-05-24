# 08. 환경 설정 및 배포 가이드

- **버전**: v1.0
- **작성일**: 2026-03-31
- **대상**: Node.js 백엔드 개발자 / DevOps

---

## 1. 개요 (Overview)

Pvpentech CSMS Node.js 서버의 환경 변수 구성, 로컬 개발 설정, 프로덕션 배포 절차를 정의합니다.

---

## 2. 환경 변수 구성

### 2.1 `.env.example` (전체 변수 목록)

```dotenv
# ─────────────────────────────────
# 서버
# ─────────────────────────────────
NODE_ENV=development          # development | production | test
PORT=3000

# ─────────────────────────────────
# 데이터베이스
# ─────────────────────────────────
DATABASE_URL=postgresql://pvpentech:password@localhost:5432/pvpentech_db

# ─────────────────────────────────
# Redis
# ─────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# ─────────────────────────────────
# 인증 (JWT)
# ─────────────────────────────────
JWT_SECRET=your-very-long-random-secret-key-at-least-32-chars
JWT_EXPIRES_IN=24h

# ─────────────────────────────────
# OCPP
# ─────────────────────────────────
OCPP_RESPONSE_TIMEOUT_MS=30000    # CP 응답 대기 최대 시간 (ms)
OCPP_HEARTBEAT_INTERVAL_SEC=60    # Heartbeat 주기 (초)

# ─────────────────────────────────
# 요금 설정
# ─────────────────────────────────
DEFAULT_UNIT_PRICE_KRW=250        # 기본 충전 단가 (원/kWh)

# ─────────────────────────────────
# 로깅
# ─────────────────────────────────
LOG_LEVEL=info                    # fatal | error | warn | info | debug | trace
LOG_PRETTY=true                   # 개발 시 가독성 향상 (프로덕션: false)

# ─────────────────────────────────
# CORS
# ─────────────────────────────────
CORS_ORIGIN=https://www.pvpentech.kr,https://pvpentech.kr
```

### 2.2 Zod 기반 환경 변수 검증 (`src/config/env.ts`)

```typescript
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  OCPP_RESPONSE_TIMEOUT_MS: z.coerce.number().default(30000),
  OCPP_HEARTBEAT_INTERVAL_SEC: z.coerce.number().default(60),

  DEFAULT_UNIT_PRICE_KRW: z.coerce.number().default(250),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),

  CORS_ORIGIN: z.string().default('https://www.pvpentech.kr'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment variable validation failed:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
```

---

## 3. Prisma 설정 (`src/config/database.ts`)

```typescript
import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

prisma.$on('error', (e) => logger.error(e, 'Prisma error'));
prisma.$on('warn', (e) => logger.warn(e, 'Prisma warning'));

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

---

## 4. Redis 설정 (`src/config/redis.ts`)

```typescript
import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error({ err }, 'Redis error'));
```

---

## 5. Pino 로거 설정 (`src/config/logger.ts`)

```typescript
import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.LOG_PRETTY
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
  base: { service: 'pvpentech-csms' },
});
```

---

## 6. 프로젝트 초기 설정

### 6.1 `package.json` 스크립트

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:generate": "prisma generate",
    "db:seed": "ts-node scripts/seed.ts",
    "db:studio": "prisma studio",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write src"
  }
}
```

### 6.2 주요 의존성

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "@prisma/client": "^5.10.0",
    "ioredis": "^5.3.2",
    "bullmq": "^5.1.0",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "zod": "^3.22.4",
    "pino": "^8.19.0",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.2.0",
    "dotenv": "^16.4.1",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.10",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/bcrypt": "^5.0.2",
    "@types/cors": "^2.8.17",
    "@types/node": "^20.11.0",
    "prisma": "^5.10.0",
    "ts-node-dev": "^2.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "@types/jest": "^29.5.12",
    "supertest": "^6.3.4",
    "@types/supertest": "^6.0.2",
    "pino-pretty": "^11.0.0"
  }
}
```

---

## 7. PM2 배포 설정

### 7.1 `ecosystem.config.js`

```javascript
module.exports = {
  apps: [
    {
      name: 'pvpentech-csms',
      script: 'dist/server.js',
      instances: 1,           // OCPP WebSocket 상태 공유 이슈로 단일 인스턴스 권장
                              // 멀티 인스턴스 필요 시 Redis Pub/Sub 기반 확장 필요
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
    },
  ],
};
```

### 7.2 배포 명령어

```bash
# 빌드
npm run build

# DB 마이그레이션 (프로덕션)
npm run db:migrate:deploy

# Prisma Client 재생성
npm run db:generate

# PM2 시작
pm2 start ecosystem.config.js --env production

# 재시작
pm2 restart pvpentech-csms

# 로그 확인
pm2 logs pvpentech-csms

# 상태 확인
pm2 status
```

---

## 8. Nginx 설정 예시

```nginx
# /etc/nginx/sites-available/pvpentech

server {
    listen 80;
    server_name pvpentech.kr www.pvpentech.kr;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pvpentech.kr www.pvpentech.kr;

    ssl_certificate     /etc/letsencrypt/live/pvpentech.kr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pvpentech.kr/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # REST API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # OCPP WebSocket
    location /ocpp/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;   # WebSocket 연결 유지 (1시간)
        proxy_send_timeout 3600s;
    }
}
```

---

## 9. 로컬 개발 환경 설정

```bash
# 1. 저장소 클론 후 의존성 설치
npm install

# 2. 환경 변수 파일 생성
cp .env.example .env
# .env 파일 편집 (DATABASE_URL, JWT_SECRET 등 설정)

# 3. Docker로 PostgreSQL + Redis 실행 (로컬 개발용)
docker run -d --name pvpentech-pg \
  -e POSTGRES_USER=pvpentech \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=pvpentech_db \
  -p 5432:5432 \
  postgres:15

docker run -d --name pvpentech-redis \
  -p 6379:6379 \
  redis:7-alpine

# 4. DB 마이그레이션 및 Prisma Client 생성
npm run db:migrate
npm run db:generate

# 5. 초기 데이터 시드
npm run db:seed

# 6. 개발 서버 시작 (hot reload)
npm run dev
```

---

## 10. 체크리스트

- [ ] `.env.example` 작성 완료, `.env` git ignore 등록 확인
- [ ] Zod 환경 변수 검증 통과 확인
- [ ] `JWT_SECRET` 32자 이상 설정
- [ ] PostgreSQL 연결 및 마이그레이션 완료
- [ ] Redis 연결 확인
- [ ] `npm run build` TypeScript 컴파일 에러 없음
- [ ] PM2 `ecosystem.config.js` 설정 완료
- [ ] Nginx HTTPS + WebSocket 프록시 설정 완료
- [ ] `pm2 logs` 로그 정상 출력 확인
- [ ] 방화벽: 포트 80/443 외부 허용, 3000/5432/6379 내부 전용 확인
