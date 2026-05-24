# 07. 에러 핸들링 패턴 가이드

- **버전**: v1.0
- **작성일**: 2026-03-31
- **대상**: Node.js 백엔드 개발자

---

## 1. 개요 (Overview)

에러 처리는 다음 세 가지 목표를 달성해야 합니다.

1. **앱/포털 사용자**: 명확한 HTTP 상태 코드와 다국어(ko/en/vi) 메시지 반환
2. **OCPP 충전기**: CallError 형식으로 Graceful Failure — 서버가 절대 크래시되지 않아야 함 (OCTT 인증 요구사항)
3. **에러 코드/메시지 분리**: 에러 코드(`code`)는 언어 무관 고정 영문값, 메시지(`message`)는 `Accept-Language` 기반 다국어로 분리 관리

---

## 2. 커스텀 에러 클래스 정의

### 2.1 에러 코드(code)와 번역 키(messageKey) 분리 패턴

에러 응답은 두 가지 식별자를 분리하여 관리합니다.

| 필드 | 역할 | 예시 |
|------|------|------|
| `code` | 클라이언트 로직 분기용 고정 영문 코드 (언어 무관) | `"NOT_FOUND"`, `"CONFLICT"` |
| `messageKey` | i18next 번역 키 (네임스페이스:키 형식) | `"error:notFound"`, `"charge:stationNotFound"` |
| `message` | 최종 사용자에게 반환되는 번역된 문자열 | `"Trạm sạc không tồn tại."` |

에러 클래스는 `messageKey`를 보유하고, 전역 에러 핸들러가 `req.t(messageKey)`로 번역하여 `message`를 채웁니다.

```typescript
// src/utils/errors.ts

export class AppError extends Error {
  constructor(
    public readonly message: string,       // 기본 메시지 (폴백용)
    public readonly statusCode: number,
    public readonly code: string,          // 에러 코드 (언어 무관 고정값)
    public readonly messageKey?: string,   // i18next 번역 키 (예: "error:notFound")
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = '잘못된 요청입니다.', messageKey = 'error:validationFailed') {
    super(message, 400, 'BAD_REQUEST', messageKey);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '인증에 실패했습니다.', messageKey = 'error:unauthorized') {
    super(message, 401, 'UNAUTHORIZED', messageKey);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = '접근 권한이 없습니다.', messageKey = 'error:forbidden') {
    super(message, 403, 'FORBIDDEN', messageKey);
  }
}

export class NotFoundError extends AppError {
  constructor(message = '리소스를 찾을 수 없습니다.', messageKey = 'error:notFound') {
    super(message, 404, 'NOT_FOUND', messageKey);
  }
}

export class ConflictError extends AppError {
  constructor(message = '이미 존재하는 리소스입니다.', messageKey = 'error:conflict') {
    super(message, 409, 'CONFLICT', messageKey);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, messageKey?: string) {
    super(message, 422, 'UNPROCESSABLE', messageKey);
  }
}

export class InternalError extends AppError {
  constructor(message = '서버 내부 오류가 발생했습니다.', messageKey = 'error:internalServer') {
    super(message, 500, 'INTERNAL_ERROR', messageKey);
  }
}
```

### 2.2 도메인별 에러 사용 예시

도메인별로 구체적인 `messageKey`를 지정하여 세분화된 다국어 메시지를 제공합니다.

```typescript
// 충전기를 찾을 수 없을 때 - 도메인 특화 번역 키 사용
throw new NotFoundError('존재하지 않는 충전기입니다.', 'charge:stationNotFound');

// 세션 중복일 때
throw new ConflictError('이미 사용 중인 충전기입니다.', 'charge:alreadyInUse');

// 범용 권한 오류일 때 - 기본 번역 키 사용
throw new ForbiddenError();
```

---

## 3. 전역 에러 핸들러 미들웨어

전역 에러 핸들러는 `AppError.messageKey`가 있으면 `req.t()`로 번역하여 `message`를 채웁니다. `messageKey`가 없으면 기본 `message`를 그대로 사용합니다.

```typescript
// src/middlewares/errorHandler.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '@utils/errors';
import { logger } from '@config/logger';

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Zod 유효성 검사 에러
  if (error instanceof ZodError) {
    const firstError = error.errors[0];
    // req.t: i18next-http-middleware가 주입하는 번역 함수
    const message = req.t ? req.t('error:validationFailed') : (firstError?.message ?? '입력값이 올바르지 않습니다.');
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
      },
    });
    return;
  }

  // 2. 커스텀 AppError (비즈니스 로직 에러)
  if (error instanceof AppError) {
    const logLevel = error.statusCode >= 500 ? 'error' : 'warn';
    logger[logLevel]({ error, path: req.path }, `AppError: ${error.code}`);

    // messageKey가 있으면 Accept-Language 기반 번역, 없으면 기본 메시지 사용
    const message = (req.t && error.messageKey)
      ? req.t(error.messageKey)
      : error.message;

    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,      // 언어 무관 고정값 (클라이언트 로직 분기용)
        message,               // Accept-Language 기반 다국어 메시지
      },
    });
    return;
  }

  // 3. 예상치 못한 에러
  logger.error({ error, path: req.path, method: req.method }, 'Unhandled error');

  const message = req.t ? req.t('error:internalServer') : '서버 내부 오류가 발생했습니다.';
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  });
}
```

### 앱 호환 에러 형식 (다국어 적용)

앱은 `{ detail: "..." }` 형식의 에러 응답을 기대합니다.
모바일 충전 API 라우터에는 별도 에러 핸들러를 적용하되, `detail` 필드에도 다국어 메시지를 반환합니다.

```typescript
// src/middlewares/appErrorHandler.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { AppError } from '@utils/errors';
import { logger } from '@config/logger';

// 모바일 앱 API 전용 에러 핸들러 (기존 스펙 호환 + 다국어)
export function appErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof AppError) {
    // messageKey가 있으면 Accept-Language 기반 번역 적용
    const detail = (req.t && error.messageKey)
      ? req.t(error.messageKey)
      : error.message;

    res.status(error.statusCode).json({ detail });
    return;
  }

  logger.error({ error, path: req.path }, 'Unhandled error in app API');
  const detail = req.t ? req.t('error:internalServer') : '서버 오류가 발생했습니다.';
  res.status(500).json({ detail });
}
```

### 다국어 에러 응답 예시

동일한 충전기 중복 사용 에러(`ConflictError`)가 언어별로 다르게 반환됩니다.

```
// Accept-Language: ko
{ "success": false, "error": { "code": "CONFLICT", "message": "이미 사용 중인 충전기입니다." } }

// Accept-Language: en
{ "success": false, "error": { "code": "CONFLICT", "message": "The charging station is already in use." } }

// Accept-Language: vi
{ "success": false, "error": { "code": "CONFLICT", "message": "Trạm sạc đang được sử dụng." } }
```

---

## 4. OCPP Graceful Failure 패턴

OCPP 핸들러는 예외가 발생해도 서버를 중단하지 않고 CallError로 응답합니다.

```typescript
// src/ocpp/messageRouter.ts (에러 처리 부분)

async handle(stationId: string, ws: WebSocket, raw: string): Promise<void> {
  let messageId = 'unknown';

  try {
    const message = parseOcppMessage(raw);
    messageId = message.messageId;

    // ... 메시지 처리 ...

  } catch (error) {
    // 어떤 에러가 와도 서버는 계속 동작
    logger.error({ stationId, messageId, error }, 'OCPP message handling error');

    // 에러 종류에 따른 OCPP 에러 코드 분기
    const [ocppErrorCode, description] = classifyOcppError(error);

    try {
      ws.send(serializeCallError(messageId, ocppErrorCode, description));
    } catch (sendError) {
      // 전송 자체도 실패하면 로그만 남기고 무시
      logger.error({ stationId, sendError }, 'Failed to send CallError');
    }
  }
}

function classifyOcppError(error: unknown): [string, string] {
  if (error instanceof Error) {
    if (error.message.includes('JSON')) return ['ProtocolError', 'Invalid JSON format'];
    if (error.message.includes('Schema')) return ['FormationViolation', 'Schema validation failed'];
    if (error.message.includes('NotImplemented')) return ['NotImplemented', error.message];
  }
  return ['InternalError', 'Internal server error'];
}
```

---

## 5. 서비스 레이어 에러 처리 패턴

서비스 레이어에서 에러를 throw할 때, `messageKey`를 명시하여 다국어 번역이 올바르게 적용되도록 합니다.

```typescript
// src/services/charge.service.ts (에러 처리 예시)
import { NotFoundError, ConflictError, UnprocessableError } from '@utils/errors';

async startCharge(params: StartChargeParams): Promise<{ sessionId: string }> {
  // 충전기 존재 확인
  const station = await this.stationRepo.findById(params.qrCode);
  if (!station || !station.isActive) {
    // messageKey를 명시 → 전역 에러 핸들러에서 req.t('charge:stationNotFound') 호출
    throw new NotFoundError('존재하지 않는 충전기입니다.', 'charge:stationNotFound');
  }

  // 동일 충전기 중복 세션 방지
  const activeSession = await this.transactionRepo.findActiveByStation(params.qrCode);
  if (activeSession) {
    throw new ConflictError('이미 사용 중인 충전기입니다.', 'charge:alreadyInUse');
  }

  // 충전기 연결 상태 확인
  if (!connectionManager.isConnected(params.qrCode)) {
    throw new UnprocessableError('충전기가 오프라인 상태입니다.', 'charge:stationOffline');
  }

  // ... 세션 생성 및 RemoteStart 전송
}
```

---

## 6. 비동기 에러 처리 유틸리티

Express 5 미만 버전에서는 async 함수의 에러를 자동으로 잡지 않습니다.
`asyncHandler` 래퍼를 사용합니다.

```typescript
// src/utils/asyncHandler.ts
import { Request, Response, NextFunction, RequestHandler } from 'express';

export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

```typescript
// 사용 예시
router.get('/status', authMiddleware, asyncHandler(controller.getStatus));
```

> **참고**: Express 5.x로 업그레이드하면 async 함수 에러가 자동으로 next()로 전달되어 `asyncHandler` 불필요합니다.

---

## 7. 로깅 레벨 기준

| 레벨 | 사용 시점 | 예시 |
|------|-----------|------|
| `error` | 서버 오류, 예상치 못한 예외 | 500 에러, DB 연결 실패 |
| `warn` | 예상된 비즈니스 오류, 인증 실패 | 401/403/404, 잘못된 OCPP 메시지 |
| `info` | 주요 이벤트 | 로그인, 충전 시작/종료, CP 연결/해제 |
| `debug` | 디버깅 정보 | 쿼리 파라미터, 내부 상태 |

---

## 8. 체크리스트

- [ ] 커스텀 에러 클래스 전체 정의 완료 (`code` + `messageKey` 필드 포함)
- [ ] 전역 에러 핸들러 `app.use(errorHandler)` 등록 (모든 라우터 뒤에 위치)
- [ ] 모바일 앱 API에 `appErrorHandler` 적용 (`/api/` 하위)
- [ ] OCPP 핸들러 try-catch로 완전히 감싸져 있는지 확인
- [ ] `asyncHandler` 래퍼 적용 또는 Express 5.x 사용
- [ ] 에러 응답에 `passwordHash` 등 민감 정보 절대 포함하지 않도록 확인
- [ ] `process.on('unhandledRejection')` 및 `uncaughtException` 전역 핸들러 등록
- [ ] 전역 에러 핸들러에서 `req.t(error.messageKey)` 다국어 번역 적용 확인
- [ ] 서비스 레이어 에러 throw 시 `messageKey` 명시 (`charge:stationNotFound` 등)
- [ ] `locales/{ko,en,vi}/error.json` 및 도메인별 번역 파일 작성 완료
