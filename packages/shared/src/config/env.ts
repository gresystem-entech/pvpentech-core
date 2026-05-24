import dotenv from 'dotenv';
import { z } from 'zod';

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

  // deprecated: DEFAULT_UNIT_PRICE_KRW (replaced by VND)
  DEFAULT_UNIT_PRICE_VND: z.coerce.number().default(3500),
  MB_BANK_IS_MOCK: z.string().transform(v => v === 'true' || v === '1').default('false'),

  // MB Bank Corporate Transfer API (정산 송금용)
  MB_BANK_TRANSFER_URL: z.string().optional(),
  MB_BANK_TRANSFER_MERCHANT_ID: z.string().optional(),
  MB_BANK_TRANSFER_ACCESS_CODE: z.string().optional(),
  MB_BANK_TRANSFER_HASH_KEY: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z.string().transform((v) => v === 'true' || v === '1').default('false'),

  CORS_ORIGIN: z.string().default('https://www.pvpentech.com'),

  CSMS_SERVER_URL: z.string().default('wss://pvpentech.example.com'),
  PROVISION_ALLOWED_CIDRS: z.string().optional(),

  SWAGGER_USER: z.string().default('admin'),
  SWAGGER_PASSWORD: z.string().default('pvpentech'),

  // 펌웨어 관리 (Phase 4-B)
  FIRMWARE_STORAGE_DIR: z.string().default('./storage/firmware'),  // 로컬 저장 경로
  FIRMWARE_BASE_URL: z.string().default('https://csms.pvpentech.com/firmware'), // 충전기에 전달할 다운로드 URL prefix
  FIRMWARE_MAX_SIZE_MB: z.coerce.number().default(100),  // 단일 파일 최대 크기 (MB)

  // 환불 배치 (Dispatcher + Worker pool 구조)
  REFUND_ATTEMPT_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  REFUND_DISPATCH_CHUNK_SIZE: z.coerce.number().int().min(1).max(5000).default(500),
  REFUND_DISPATCH_MAX_CANDIDATES: z.coerce.number().int().min(1).default(10000),  // 기본 10000, 운영에서 env로 조정 가능

  // Phase 2-B: Internal API 인증 (Portal → Core 서비스 간 통신)
  // 필수 값, 최소 32자 이상 랜덤 문자열
  CSMS_INTERNAL_API_TOKEN: z.string().min(32, 'CSMS_INTERNAL_API_TOKEN must be at least 32 characters').optional(),
  // Portal이 Core Internal API를 호출할 base URL
  CSMS_INTERNAL_API_BASE_URL: z.string().default('http://localhost:3001/api/internal/v1'),

  // Phase 2-E: 분리 진입점 포트 설정
  CORE_PORT: z.coerce.number().default(3001),
  PORTAL_PORT: z.coerce.number().default(3002),
  LEGACY_PORT: z.coerce.number().default(3000),

});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment variable validation failed:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
