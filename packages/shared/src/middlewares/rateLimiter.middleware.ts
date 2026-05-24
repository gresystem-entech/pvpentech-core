import rateLimit from 'express-rate-limit';

// 일반 API Rate Limiter
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

// 로그인 Rate Limiter (분당 10회)
export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1분
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

// 프로비저닝 Rate Limiter (IP당 분당 5회, 시간당 20회)
export const provisionRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1분
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
  },
});
