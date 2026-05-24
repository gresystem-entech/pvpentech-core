# 02. 프로젝트 디렉토리 구조 가이드

- **버전**: v1.0
- **작성일**: 2026-03-31
- **대상**: Node.js 백엔드 개발자

---

## 1. 개요 (Overview)

Pvpentech CSMS Node.js 프로젝트의 표준 디렉토리 구조를 정의합니다.
레이어드 아키텍처(Router → Controller → Service → Repository)를 기반으로, 도메인 중심으로 파일을 구성합니다.

---

## 2. 최상위 디렉토리 구조

```
pvpentech-csms/
├── src/                        # 소스 코드 루트
│   ├── app.ts                  # Express 앱 초기화 (미들웨어, 라우터 등록)
│   ├── server.ts               # HTTP + WebSocket 서버 진입점
│   ├── config/                 # 환경 설정
│   ├── routes/                 # Express 라우터
│   ├── controllers/            # 요청/응답 처리 (컨트롤러)
│   ├── services/               # 비즈니스 로직
│   ├── repositories/           # DB 접근 레이어 (Prisma)
│   ├── ocpp/                   # OCPP 1.6 WebSocket 핸들러
│   ├── middlewares/            # Express 미들웨어
│   ├── validators/             # Zod 스키마 유효성 검사
│   ├── types/                  # TypeScript 타입/인터페이스 정의
│   ├── utils/                  # 공통 유틸리티 함수
│   └── jobs/                   # BullMQ 백그라운드 작업
├── prisma/
│   ├── schema.prisma           # Prisma 데이터 스키마
│   └── migrations/             # DB 마이그레이션 파일
├── locales/                    # 다국어(i18n) 번역 파일
│   ├── ko/                     # 한국어 (기본 언어)
│   │   ├── common.json
│   │   ├── error.json
│   │   ├── auth.json
│   │   ├── charge.json
│   │   ├── station.json
│   │   ├── user.json
│   │   ├── partner.json
│   │   └── notification.json
│   ├── en/                     # 영어
│   │   └── (ko와 동일 파일 구조)
│   └── vi/                     # 베트남어
│       └── (ko와 동일 파일 구조)
├── tests/
│   ├── unit/                   # 단위 테스트
│   ├── integration/            # 통합 테스트
│   └── fixtures/               # 테스트용 픽스처 데이터
├── docs/                       # API 문서 (OpenAPI 등)
├── scripts/
│   ├── seed.ts                 # DB 시드 데이터
│   ├── deploy.sh               # 배포 스크립트
│   └── validateTranslations.ts # 번역 파일 누락 키 검증 스크립트
├── .env                        # 환경 변수 (git 제외)
├── .env.example                # 환경 변수 템플릿
├── .eslintrc.json              # ESLint 설정
├── .prettierrc                 # Prettier 설정
├── jest.config.ts              # Jest 설정
├── tsconfig.json               # TypeScript 설정
├── package.json
└── ecosystem.config.js         # PM2 설정
```

---

## 3. 상세 디렉토리 구조

### 3.1 `src/config/`

```
src/config/
├── index.ts          # 설정 진입점 (모든 설정 export)
├── database.ts       # Prisma 클라이언트 싱글턴
├── redis.ts          # Redis / ioredis 클라이언트
├── logger.ts         # Pino 로거 설정
├── i18n.ts           # i18next 초기화 (다국어 지원: ko/en/vi)
└── env.ts            # Zod 기반 환경 변수 검증
```

### 3.2 `src/routes/`

```
src/routes/
├── index.ts              # 라우터 루트 (모든 라우터 통합)
├── auth.routes.ts        # POST /api/login, /api/logout
├── charge.routes.ts      # POST /api/charge/start, GET /api/charge/status, POST /api/charge/stop
├── station.routes.ts     # 충전기 관리 REST API
├── user.routes.ts        # 사용자 관리 REST API
├── partner.routes.ts     # 파트너 관리 REST API
├── site.routes.ts        # 충전소 관리 REST API
├── session.routes.ts     # 충전 이력 조회 REST API
└── stats.routes.ts       # 통계 REST API
```

### 3.3 `src/controllers/`

```
src/controllers/
├── auth.controller.ts
├── charge.controller.ts
├── station.controller.ts
├── user.controller.ts
├── partner.controller.ts
├── site.controller.ts
├── session.controller.ts
└── stats.controller.ts
```

### 3.4 `src/services/`

```
src/services/
├── auth.service.ts           # 로그인, JWT 발급/검증
├── charge.service.ts         # 충전 세션 시작/상태/종료 (OCPP RemoteStart/Stop 연동)
├── station.service.ts        # 충전기 CRUD, 상태 관리
├── user.service.ts           # 사용자 CRUD
├── partner.service.ts        # 파트너 CRUD, 승인
├── site.service.ts           # 충전소 CRUD, 단가 관리
├── session.service.ts        # 충전 이력 조회
├── stats.service.ts          # 통계 집계
├── ocppMessage.service.ts    # OCPP 메시지 로그 저장/조회
└── faultLog.service.ts       # 충전기 장애이력 관리
```

### 3.5 `src/repositories/`

```
src/repositories/
├── station.repository.ts
├── user.repository.ts
├── partner.repository.ts
├── site.repository.ts
├── transaction.repository.ts
├── meterValue.repository.ts
├── idToken.repository.ts
├── ocppMessage.repository.ts
└── faultLog.repository.ts
```

### 3.6 `src/ocpp/` — OCPP 1.6 핵심 모듈

```
src/ocpp/
├── server.ts                   # WebSocket 서버 초기화, 연결 수락
├── connectionManager.ts        # 연결된 CP Map 관리 (Map<stationId, WebSocket>)
├── messageRouter.ts            # OCPP 메시지 Action 기반 핸들러 라우팅
├── messageParser.ts            # OCPP 메시지 파싱/직렬화 ([2,3,4] 형식)
├── schemaValidator.ts          # OCPP 1.6 JSON Schema 유효성 검사
├── pendingRequests.ts          # 응답 대기 Map 관리 (messageId → Promise)
├── handlers/                   # OCPP Action 핸들러
│   ├── bootNotification.handler.ts
│   ├── heartbeat.handler.ts
│   ├── statusNotification.handler.ts
│   ├── startTransaction.handler.ts
│   ├── stopTransaction.handler.ts
│   ├── authorize.handler.ts
│   ├── meterValues.handler.ts
│   ├── dataTransfer.handler.ts
│   └── index.ts                # 핸들러 등록 맵
└── commands/                   # CSMS → CP 명령 전송
    ├── remoteStartTransaction.command.ts
    ├── remoteStopTransaction.command.ts
    ├── reset.command.ts
    ├── changeAvailability.command.ts
    └── index.ts
```

### 3.7 `src/middlewares/`

```
src/middlewares/
├── auth.middleware.ts          # JWT 검증 미들웨어
├── role.middleware.ts          # 역할 기반 접근 제어 (cs / partner / customer)
├── errorHandler.middleware.ts  # 전역 에러 핸들러 (i18n 다국어 에러 메시지 포함)
├── appErrorHandler.middleware.ts # 모바일 앱 전용 에러 핸들러 ({ detail } 형식)
├── userLanguage.middleware.ts  # 사용자 DB 저장 언어 설정 적용 미들웨어
├── requestLogger.middleware.ts # 요청 로깅
└── rateLimiter.middleware.ts   # Rate Limiting
```

### 3.8 `src/validators/`

```
src/validators/
├── auth.validator.ts
├── charge.validator.ts
├── station.validator.ts
├── user.validator.ts
└── partner.validator.ts
```

### 3.9 `src/types/`

```
src/types/
├── ocpp.types.ts       # OCPP 메시지 타입 (Call, CallResult, CallError)
├── express.d.ts        # Express Request 타입 확장 (req.user 등)
└── common.types.ts     # 공통 타입 (ApiResponse, PaginatedResponse 등)
```

### 3.10 `src/jobs/`

```
src/jobs/
├── index.ts                  # BullMQ Worker 초기화
├── queues.ts                 # 큐 정의 (charge, notification 등)
├── processors/
│   ├── chargeGoal.processor.ts   # 충전 목표 달성 체크
│   ├── sessionTimeout.processor.ts # 세션 타임아웃 처리
│   └── ocppLogCleanup.processor.ts # OCPP 메시지 로그 만료 삭제
└── schedulers/
    └── daily.scheduler.ts        # 일별 정기 작업
```

---

## 4. 파일 명명 규칙

| 구분 | 규칙 | 예시 |
|------|------|------|
| 파일명 | `{도메인}.{레이어}.ts` | `charge.service.ts` |
| 클래스명 | PascalCase | `ChargeService` |
| 함수/메서드명 | camelCase | `startChargeSession()` |
| 상수 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 인터페이스 | `I` 접두사 생략, 타입명 명시 | `ChargeSession`, `OcppMessage` |
| DB 테이블명 | snake_case (Prisma) | `charging_station`, `meter_value` |
| 환경 변수 | UPPER_SNAKE_CASE | `DATABASE_URL`, `JWT_SECRET` |

---

## 5. Import 규칙

절대 경로 import를 사용합니다 (`tsconfig.json`의 `paths` 설정 활용).

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@config/*": ["src/config/*"],
      "@services/*": ["src/services/*"],
      "@repositories/*": ["src/repositories/*"],
      "@ocpp/*": ["src/ocpp/*"],
      "@types/*": ["src/types/*"],
      "@utils/*": ["src/utils/*"]
    }
  }
}
```

```typescript
// 사용 예시
import { ChargeService } from '@services/charge.service';
import { prisma } from '@config/database';
import { OcppCall } from '@types/ocpp.types';
```

---

## 6. `src/server.ts` 진입점 예시

```typescript
import http from 'http';
import { app } from './app';
import { initOcppWebSocketServer } from '@ocpp/server';
import { logger } from '@config/logger';
import { env } from '@config/env';

const server = http.createServer(app);

// OCPP WebSocket 서버를 동일 HTTP 서버에 연결
initOcppWebSocketServer(server);

server.listen(env.PORT, () => {
  logger.info(`Pvpentech CSMS running on port ${env.PORT}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught Exception');
  process.exit(1);
});
```

---

## 7. 체크리스트

- [ ] 디렉토리 구조 생성 완료
- [ ] tsconfig.json paths 별칭 설정 완료
- [ ] ESLint + Prettier 설정 완료
- [ ] 각 레이어별 index.ts (barrel export) 작성
- [ ] .env.example 파일 작성 완료
- [ ] 파일 명명 규칙 팀 내 공유 완료
- [ ] `locales/{ko,en,vi}/` 디렉토리 및 번역 JSON 파일 초기 생성 완료
- [ ] `src/config/i18n.ts` 파일 생성 및 초기화 완료
- [ ] `scripts/validateTranslations.ts` 번역 검증 스크립트 작성 완료
