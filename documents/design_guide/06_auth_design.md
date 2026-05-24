# 06. 인증/인가 설계 가이드

- **버전**: v1.1
- **작성일**: 2026-03-31
- **업데이트**: 2026-03-31 (v1.1 — usage_scenario.txt 반영: 프로비저닝 인증, 파트너 pending 플로우 보강, 역할별 메뉴 접근 권한 매핑)
- **대상**: Node.js 백엔드 개발자

---

## 1. 개요 (Overview)

Pvpentech는 두 가지 인증 체계를 운용합니다.

| 대상 | 인증 방식 | 설명 |
|------|-----------|------|
| 모바일 앱 사용자 | JWT Bearer Token | 로그인 후 토큰 발급, 앱 로컬 저장 |
| 포털 사용자 | JWT Bearer Token (세션리스) | 역할(cs/partner/customer) 기반 접근 제어 |
| 충전기 (OCPP) | HTTP Basic Auth | WebSocket 연결 시 stationId + 비밀번호 검증 |

---

## 2. JWT 설계

### 2.1 Access Token

```typescript
interface JwtPayload {
  sub: number;          // userId (User.id)
  username: string;     // User.username
  role: 'cs' | 'partner' | 'customer';
  iat: number;          // 발급 시각
  exp: number;          // 만료 시각
}
```

| 항목 | 값 |
|------|-----|
| 알고리즘 | HS256 |
| 만료 시간 | 24시간 (앱) / 8시간 (포털) |
| 서명 키 | `JWT_SECRET` 환경 변수 (32자 이상 랜덤 문자열) |

### 2.2 토큰 발급 유틸리티

```typescript
// src/utils/jwt.ts
import jwt from 'jsonwebtoken';
import { env } from '@config/env';

export interface JwtPayload {
  sub: number;
  username: string;
  role: string;
}

export function signToken(payload: JwtPayload, expiresIn = '24h'): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
```

---

## 3. 인증 미들웨어

### 3.1 JWT 검증 미들웨어

```typescript
// src/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@utils/jwt';
import { logger } from '@config/logger';

// Express Request 타입 확장
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        role: string;
      };
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ detail: '인증 토큰이 필요합니다.' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyToken(token);
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };
    next();
  } catch (error) {
    logger.warn({ error }, 'JWT verification failed');
    res.status(401).json({ detail: '인증에 실패했습니다.' });
  }
}
```

### 3.2 역할 기반 접근 제어 미들웨어

```typescript
// src/middlewares/role.middleware.ts
import { Request, Response, NextFunction } from 'express';

type Role = 'cs' | 'partner' | 'customer';

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ detail: '인증이 필요합니다.' });
      return;
    }

    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({ detail: '접근 권한이 없습니다.' });
      return;
    }

    next();
  };
}
```

### 3.3 라우터에서 사용 예시

```typescript
// src/routes/portal.routes.ts
import { requireRole } from '@middlewares/role.middleware';
import { authMiddleware } from '@middlewares/auth.middleware';

// CS 전용
router.get('/cs/users', authMiddleware, requireRole('cs'), csUserController.list);

// 파트너 전용
router.get('/partner/sites', authMiddleware, requireRole('partner'), partnerController.sites);

// 고객 전용
router.get('/customer/history', authMiddleware, requireRole('customer'), customerController.history);
```

---

## 4. 비밀번호 처리

### 4.1 해시 및 검증

```typescript
// src/utils/password.ts
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

---

## 5. 로그인 서비스 구현

```typescript
// src/services/auth.service.ts
import { prisma } from '@config/database';
import { comparePassword, hashPassword } from '@utils/password';
import { signToken } from '@utils/jwt';
import { logger } from '@config/logger';

export class AuthService {
  async login(username: string, password: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('아이디 또는 비밀번호가 틀렸습니다.');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedError('승인 대기 중인 계정입니다. 관리자에게 문의하세요.');
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('아이디 또는 비밀번호가 틀렸습니다.');
    }

    const token = signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
    });

    logger.info({ userId: user.id, role: user.role }, 'User logged in');
    return token;
  }

  async register(data: RegisterDto): Promise<void> {
    const existing = await prisma.user.findUnique({ where: { username: data.username } });
    if (existing) {
      throw new ConflictError('이미 사용 중인 아이디입니다.');
    }

    const passwordHash = await hashPassword(data.password);

    // 고객은 즉시 active, 파트너/CS는 pending
    const status = data.role === 'customer' ? 'active' : 'pending';

    await prisma.user.create({
      data: {
        username: data.username,
        passwordHash,
        email: data.email,
        role: data.role,
        status,
      },
    });
  }
}
```

---

## 6. OCPP Basic Auth 검증

충전기(CP)는 WebSocket 연결 시 `Authorization: Basic <base64(stationId:password)>` 헤더를 전송합니다.

```typescript
// src/utils/auth.ts
import { Buffer } from 'buffer';
import { prisma } from '@config/database';
import { comparePassword } from '@utils/password';

export async function verifyOcppBasicAuth(
  stationId: string,
  authHeader: string | undefined
): Promise<boolean> {
  if (!authHeader?.startsWith('Basic ')) return false;

  const encoded = authHeader.slice(6);
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  const [id, password] = decoded.split(':');

  if (id !== stationId) return false;

  // DB에서 충전기 비밀번호 확인
  const station = await prisma.chargingStation.findUnique({
    where: { id: stationId },
    select: { passwordHash: true, isActive: true },
  });

  if (!station || !station.isActive || !station.passwordHash) return false;

  return comparePassword(password, station.passwordHash);
}
```

> **참고**: `ChargingStation` 모델에 `passwordHash` 필드를 추가해야 합니다. 충전기 등록 시 비밀번호를 설정하고, 연결 시 검증합니다.

---

## 7. 가입 및 승인 흐름

```
[고객 가입]
  POST /api/portal/auth/register/customer
    → User.status = 'active'  (즉시 로그인 가능)
    → 고객 포탈(/portal/customer/)로 리다이렉트

[파트너 가입]
  POST /api/portal/auth/register/partner
    → User.status = 'pending'
    → 로그인 시 "승인 대기 중" 메시지 표시 (401 반환)
    → CS 담당자가 PATCH /api/portal/cs/partners/:id/approve 호출
      → User.status = 'active', PartnerProfile 활성화
    → 이후 로그인 시 파트너 포탈(/portal/partner/)로 리다이렉트

[파트너 가입 반려]
  CS 담당자가 PATCH /api/portal/cs/partners/:id/reject 호출
    → User.status = 'inactive' (로그인 불가)

[파트너 비활성화]
  CS 담당자가 PATCH /api/portal/cs/partners/:id/deactivate 호출
    → User.isActive = false
    → 기존 JWT 토큰은 만료될 때까지 유효 (Redis 블랙리스트 운용 시 즉시 무효화 가능)

[고객 비활성화 → 충전카드 자동 차단]
  CS 담당자가 PATCH /api/portal/cs/users/:id/toggle-active 호출 (비활성화)
    → User.isActive = false
    → 해당 사용자의 모든 IdToken.status = 'Blocked' 로 자동 변경 (서비스 레이어 처리)

[고객센터 가입]
  POST /api/portal/auth/register/cs
    → User.status = 'pending'
    → 슈퍼 관리자가 직접 DB 또는 별도 관리 화면에서 승인
    → User.status = 'active'
    → 고객센터 포탈(/portal/cs/)로 리다이렉트
```

---

## 7-1. 프로비저닝 인증 [신규 — v1.1]

`POST /provision` 엔드포인트는 JWT 인증 없이 공개 접근이 가능하지만, 다음 보안 장치를 적용합니다.

| 보안 항목 | 방법 |
|-----------|------|
| Rate Limiting | IP당 분당 5회, 시간당 20회 제한 |
| serial_number 검증 | DB `charger_provisioning` 화이트리스트 일치 여부만 확인 |
| HTTPS 강제 | Nginx에서 HTTP → HTTPS 리다이렉트 적용 |
| 단일 사용 보장 | 프로비저닝 완료 즉시 `status = 'provisioned'` 변경 → 재사용 불가 |
| 비밀번호 보호 | 응답의 `password`는 1회용 평문 반환 후 서버에는 bcrypt 해시만 보관 |

---

## 7-2. 역할별 포탈 메뉴 접근 권한 [신규 — v1.1]

`requireRole` 미들웨어를 활용한 라우트 보호 전략입니다.

| API 경로 패턴 | 허용 Role |
|--------------|-----------|
| `POST /provision` | 공개 (인증 불필요) |
| `/api/portal/auth/*` | 공개 (로그인/가입) |
| `/api/portal/cs/*` | `cs` 전용 |
| `/api/portal/partner/*` | `partner` 전용 |
| `/api/portal/customer/*` | `customer` 전용 |
| `/api/admin/*` | `cs` 전용 |

```typescript
// src/routes/portal/index.ts
import { requireRole } from '@middlewares/role.middleware';
import { authMiddleware } from '@middlewares/auth.middleware';

// CS 전용 라우트
app.use('/api/portal/cs', authMiddleware, requireRole('cs'), csRouter);

// 파트너 전용 라우트
app.use('/api/portal/partner', authMiddleware, requireRole('partner'), partnerRouter);

// 고객 전용 라우트
app.use('/api/portal/customer', authMiddleware, requireRole('customer'), customerRouter);

// 관리자 전용 라우트 (OCPP 원격 명령)
app.use('/api/admin', authMiddleware, requireRole('cs'), adminRouter);
```

---

## 8. 보안 체크리스트

- [ ] `JWT_SECRET` 환경 변수 32자 이상 랜덤 문자열로 설정
- [ ] bcrypt `SALT_ROUNDS` 12 이상 설정
- [ ] 모든 보호 엔드포인트에 `authMiddleware` 적용 확인
- [ ] 역할별 엔드포인트에 `requireRole` 미들웨어 적용 확인
- [ ] OCPP Basic Auth 검증 미들웨어 적용
- [ ] 비밀번호 응답에 절대 포함하지 않도록 확인 (`passwordHash` select 제외)
- [ ] Rate Limiting 적용 (로그인 엔드포인트: 분당 10회)
- [ ] 토큰 만료 시 401 응답 확인
- [ ] HTTPS 적용 확인 (Nginx TLS 종단)
- [ ] [v1.1 신규] `POST /provision` Rate Limiting 적용 (IP당 분당 5회)
- [ ] [v1.1 신규] 파트너 `pending` 상태에서 로그인 시도 시 401 + 적절한 메시지 반환
- [ ] [v1.1 신규] 파트너 비활성화 시 기존 세션 처리 정책 결정 (토큰 만료 대기 vs 블랙리스트)
- [ ] [v1.1 신규] 고객 비활성화 시 해당 사용자 IdToken 자동 Blocked 처리 로직 구현
- [ ] [v1.1 신규] 프로비저닝 비밀번호 1회용 보장 (응답 후 평문 폐기, 해시만 DB 저장)
- [ ] [v1.1 신규] CS 전용 라우트(`/api/portal/cs/*`, `/api/admin/*`)에 `requireRole('cs')` 적용 확인
