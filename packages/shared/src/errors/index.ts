// 커스텀 에러 클래스 정의

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

export class EmptySettlementError extends AppError {
  constructor(messageKey = 'settlement.empty') {
    super('정산할 거래가 없습니다.', 400, 'EMPTY_SETTLEMENT', messageKey);
  }
}
