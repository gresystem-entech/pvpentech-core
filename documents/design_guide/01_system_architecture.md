# 01. 전체 시스템 아키텍처 가이드

- **버전**: v1.0
- **작성일**: 2026-03-31
- **대상**: Node.js 백엔드 개발자
- **목적**: FastAPI/Django 기반 아키텍처를 Node.js 단일 스택으로 마이그레이션하는 전체 시스템 설계 기준 제시

---

## 1. 개요 (Overview)

Pvpentech CSMS는 다음 세 가지 서비스를 제공합니다.

| 서비스 | 설명 |
|--------|------|
| OCPP Gateway | 충전기(CP)와 WebSocket(OCPP 1.6)으로 통신하는 관제 서버 |
| Mobile Charge API | Android 앱과 통신하는 REST API (충전 세션 관리) |
| User Portal API | 고객센터/파트너/고객 포털 REST API |

### 핵심 요구사항

| 요구사항 | 내용 |
|----------|------|
| OCPP 1.6 준수 | WebSocket 기반 충전기 통신 프로토콜 완전 구현 |
| 다국어(i18n) 지원 | 한국어(ko) / 영어(en) / 베트남어(vi) 3개 언어 필수 지원 |
| 하위 호환성 | 기존 Android 앱 API 스펙(`/api/*`) 그대로 유지 |
| 고가용성 | OCTT 인증 요구사항 준수 (충전기 통신 Graceful Failure) |

> **다국어(i18n) 정책**: 모든 사용자 노출 메시지(에러, 알림, UI 텍스트)는 `Accept-Language` 헤더 기반으로 한국어/영어/베트남어로 반환합니다. 기본 언어는 한국어(`ko`)입니다. 상세 구현은 `10_i18n_design.md`를 참조하세요.

### 마이그레이션 목표

| 기존 (Python) | 신규 (Node.js) |
|---------------|----------------|
| FastAPI (OCPP WebSocket) | Node.js + `ws` 라이브러리 |
| Django + DRF (REST API) | Node.js + Express.js |
| Celery + Redis (비동기 작업) | Node.js 내장 비동기 + Bull Queue (Redis) |
| Django ORM | Prisma ORM |
| PostgreSQL | PostgreSQL (동일) |
| Django Admin / Templates | 별도 프론트엔드 또는 API 전환 |

---

## 2. 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Pvpentech System                            │
│                                                                     │
│  ┌──────────────┐    ┌───────────────────────────────────────────┐  │
│  │  Android App │    │           Node.js CSMS Server              │  │
│  │  (Pvpentech)│    │                                           │  │
│  └──────┬───────┘    │  ┌─────────────────────────────────────┐ │  │
│         │ HTTPS      │  │          Express.js Router           │ │  │
│         │ REST API   │  │                                     │ │  │
│         ▼            │  │  /api/*         /ocpp/ws/*          │ │  │
│  ┌──────────────┐    │  │  REST Router    WS Router           │ │  │
│  │ Web Browser  │    │  └────┬────────────────┬───────────────┘ │  │
│  │  (Portal)    │    │       │                │                 │  │
│  └──────┬───────┘    │       ▼                ▼                 │  │
│         │ HTTPS      │  ┌─────────┐    ┌──────────────┐        │  │
│         │ REST API   │  │REST     │    │ OCPP WS      │        │  │
│         │            │  │API Layer│    │ Handler Layer│        │  │
│  ┌──────▼───────┐    │  └────┬────┘    └──────┬───────┘        │  │
│  │   Nginx      │    │       │                │                 │  │
│  │ (Reverse     ├────►       ▼                ▼                 │  │
│  │  Proxy)      │    │  ┌──────────────────────────────────┐   │  │
│  └──────────────┘    │  │         Service Layer            │   │  │
│                      │  │  (Business Logic / OCPP Actions) │   │  │
│  ┌──────────────┐    │  └────────────────┬─────────────────┘   │  │
│  │  Charging    │    │                   │                      │  │
│  │  Station     ├────►                   ▼                      │  │
│  │  (OCPP 1.6)  │    │  ┌──────────────────────────────────┐   │  │
│  │  WebSocket   │    │  │       Repository Layer            │   │  │
│  └──────────────┘    │  │    (Prisma ORM + PostgreSQL)     │   │  │
│                      │  └────────────────┬─────────────────┘   │  │
│                      │                   │                      │  │
│                      │  ┌────────────────▼─────────────────┐   │  │
│                      │  │            Redis                   │   │  │
│                      │  │  - Bull Queue (비동기 작업)        │   │  │
│                      │  │  - Session Cache                  │   │  │
│                      │  │  - OCPP Pending Response Cache    │   │  │
│                      │  └──────────────────────────────────┘   │  │
│                      └───────────────────────────────────────────┘  │
│                                                                     │
│                      ┌───────────────────────────────────────────┐  │
│                      │           PostgreSQL                       │  │
│                      │  (충전기, 사용자, 트랜잭션, 미터값 등)         │  │
│                      └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 핵심 설계 원칙

### 3.1 단일 Node.js 프로세스 (모놀리식 → 모듈형)

기존 FastAPI + Django 분리 구조를 **단일 Node.js 서버**로 통합합니다. 단, 내부 모듈은 명확히 분리합니다.

- OCPP WebSocket 처리와 REST API가 동일 Express 앱에서 동작
- 프로세스 내 이벤트 기반 비동기(`EventEmitter`)로 OCPP 응답 대기 처리
- 스케일 아웃 필요 시 PM2 Cluster 모드 또는 Redis Pub/Sub 기반 멀티 인스턴스 확장

### 3.2 레이어드 아키텍처

```
Router → Controller → Service → Repository → Database
```

각 레이어의 책임:

| 레이어 | 파일 위치 | 역할 |
|--------|-----------|------|
| Router | `src/routes/` | URL 라우팅, 미들웨어 연결 |
| Controller | `src/controllers/` | 요청/응답 파싱, 유효성 검사 호출 |
| Service | `src/services/` | 비즈니스 로직, 트랜잭션 조율 |
| Repository | `src/repositories/` | DB 쿼리 추상화 (Prisma 호출) |
| Model | `prisma/schema.prisma` | 데이터 스키마 정의 |

### 3.3 OCPP 메시지 처리 원칙

- 충전기 연결 시 `WebSocket` 객체를 메모리 Map에 등록 (`Map<stationId, WebSocket>`)
- OCPP Call 수신 → JSON Schema 유효성 검사 → Action Handler 라우팅
- 응답 대기: `Promise + EventEmitter` 패턴으로 비동기 응답 처리 (타임아웃: 30초)
- 충전기 상태 머신(State Machine)으로 커넥터 상태 관리

---

## 4. 기술 스택 결정

| 분류 | 선택 | 근거 |
|------|------|------|
| Runtime | Node.js 20 LTS | 안정성, LTS 지원 |
| Language | TypeScript 5.x | 타입 안정성, 유지보수성 |
| Web Framework | Express.js 4.x | 성숙도, 생태계, 팀 친숙도 |
| WebSocket | ws 8.x | 경량, OCPP subprotocol 지원 |
| ORM | Prisma 5.x | TypeScript 우선, 마이그레이션 관리 |
| Queue | BullMQ (Redis) | 기존 Redis 활용, 재시도/지연 지원 |
| Cache | ioredis | Redis 클라이언트 |
| Auth | jsonwebtoken | JWT 발급/검증 |
| Validation | Zod | TypeScript-first 스키마 검증 |
| Logging | Pino | 고성능 구조화 로깅 |
| i18n | i18next + i18next-http-middleware | 다국어(ko/en/vi) 지원, Accept-Language 기반 언어 감지 |
| Testing | Jest + Supertest | 단위/통합 테스트 |
| Process Manager | PM2 | 프로덕션 배포 |

---

## 5. 서비스 포트 구성

| 서비스 | 포트 | 프로토콜 |
|--------|------|---------|
| Main Server (HTTP + WS) | 3000 | HTTP / WebSocket |
| PostgreSQL | 5432 | TCP |
| Redis | 6379 | TCP |
| Nginx (외부) | 80 / 443 | HTTP / HTTPS |

Nginx가 외부 요청을 받아 Node.js 3000 포트로 프록시합니다.

```nginx
# OCPP WebSocket
location /ocpp/ {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# REST API
location /api/ {
    proxy_pass http://localhost:3000;
}
```

---

## 6. 보안 구성

| 항목 | 방법 |
|------|------|
| REST API 인증 | JWT Bearer Token |
| 포털 세션 | JWT (stateless) 또는 Redis 세션 |
| OCPP 인증 | Basic Auth (Security Profile 1) via `Sec-WebSocket-Protocol` |
| HTTPS | Nginx + Let's Encrypt TLS 종단 |
| 입력 유효성 검사 | Zod 스키마 (컨트롤러 레이어) |
| Rate Limiting | express-rate-limit 미들웨어 |
| CORS | cors 미들웨어 (허용 Origin 명시) |

---

## 7. 체크리스트

- [ ] Node.js 20 LTS 및 TypeScript 환경 설정 완료
- [ ] Express.js + ws 기반 서버 초기 구조 구성
- [ ] Prisma + PostgreSQL 연결 및 마이그레이션 설정
- [ ] Redis (BullMQ + ioredis) 연결 확인
- [ ] Nginx 리버스 프록시 설정 (HTTP + WebSocket)
- [ ] 환경 변수(.env) 구성 완료
- [ ] PM2 ecosystem.config.js 설정 완료
- [ ] i18next 초기화 및 `locales/{ko,en,vi}/` 번역 파일 구성 완료 (`10_i18n_design.md` 참조)
- [ ] Express 미들웨어에 i18next-http-middleware 등록 완료
