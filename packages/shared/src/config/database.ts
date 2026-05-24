import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './logger';

type LogClient = PrismaClient<{
  log: [
    { emit: 'event'; level: 'error' },
    { emit: 'event'; level: 'warn' },
  ];
}>;

const globalForPrisma = globalThis as unknown as { prisma?: LogClient };

function createPrismaClient(): LogClient {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  }) as LogClient;

  client.$on('error', (e: Prisma.LogEvent) => logger.error(e, 'Prisma error'));
  client.$on('warn', (e: Prisma.LogEvent) => logger.warn(e, 'Prisma warning'));

  return client;
}

/**
 * 단일 PrismaClient 인스턴스 (모든 schema 접근 가능).
 * @deprecated Phase 3-C 이후 prismaCore / prismaPortal 를 직접 사용할 것.
 *             Phase 3-D에서 모든 참조를 교체한 뒤 이 export를 제거한다.
 */
export const prisma: LogClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-level 분리 (접근 A) — 단일 PrismaClient 인스턴스에서
// core / portal 모델 프로퍼티를 각각 노출하는 객체.
//
// 런타임은 같은 클라이언트를 공유하며, TypeScript 컴파일 타임에
// 각 패키지가 자기 영역 모델만 접근하도록 제한한다.
//
// ※ 향후 DB 인스턴스 완전 분리 시:
//   coreModels / portalModels 각각 new PrismaClient({ datasources: ... })로 교체
//   (접근 B 전환) — database.ts 한 곳만 수정하면 됨.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core schema 모델 접근 객체.
 * packages/core/src/** 에서만 사용할 것.
 *
 * 포함 모델: ChargingStation, Connector, IdToken, Transaction, MeterValue,
 *           DeviceVariable, OcppMessage, OcppCommandResult, DiagnosticsRequest,
 *           Firmware, FirmwareCampaign, FirmwareCampaignProgress, FaultLog,
 *           Manufacturer, ChargerProvisioning, StationIdSequence, OfflineLog,
 *           ChargerConfig, OutboxEvent
 */
export const prismaCore = {
  // — 모델 접근자 —
  chargingStation: prisma.chargingStation,
  connector: prisma.connector,
  idToken: prisma.idToken,
  transaction: prisma.transaction,
  meterValue: prisma.meterValue,
  deviceVariable: prisma.deviceVariable,
  ocppMessage: prisma.ocppMessage,
  ocppCommandResult: prisma.ocppCommandResult,
  diagnosticsRequest: prisma.diagnosticsRequest,
  firmware: prisma.firmware,
  firmwareCampaign: prisma.firmwareCampaign,
  firmwareCampaignProgress: prisma.firmwareCampaignProgress,
  faultLog: prisma.faultLog,
  manufacturer: prisma.manufacturer,
  chargerProvisioning: prisma.chargerProvisioning,
  stationIdSequence: prisma.stationIdSequence,
  offlineLog: prisma.offlineLog,
  chargerConfig: prisma.chargerConfig,
  outboxEvent: prisma.outboxEvent,

  // — 유틸리티 —
  $transaction: prisma.$transaction.bind(prisma) as typeof prisma.$transaction,
  $queryRaw: prisma.$queryRaw.bind(prisma) as typeof prisma.$queryRaw,
  $executeRaw: prisma.$executeRaw.bind(prisma) as typeof prisma.$executeRaw,
  $queryRawUnsafe: prisma.$queryRawUnsafe.bind(
    prisma,
  ) as typeof prisma.$queryRawUnsafe,
  $executeRawUnsafe: prisma.$executeRawUnsafe.bind(
    prisma,
  ) as typeof prisma.$executeRawUnsafe,
  $disconnect: prisma.$disconnect.bind(prisma) as typeof prisma.$disconnect,
} as const;

/**
 * Portal schema 모델 접근 객체.
 * packages/portal/src/** 에서만 사용할 것.
 *
 * 포함 모델: ChargingSite, SitePriceHistory, User, PartnerProfile, PaymentCard,
 *           Settlement, RefundLog, RefundAttempt, CsmsVariable, ConsumedEvent,
 *           ChargeSessionProjection, PgConfig, PaymentOrder
 *
 * NOTE: Portal에서 Core 모델(ChargingStation, Transaction 등)을 직접 조회하는 코드는
 *       Phase 3-D에서 CoreApiClient 호출 또는 ChargeSessionProjection 사용으로 전환 예정.
 *       현재는 해당 파일에서 deprecated `prisma`를 임시 사용하고 TODO 주석 기재.
 */
export const prismaPortal = {
  // — 모델 접근자 —
  chargingSite: prisma.chargingSite,
  sitePriceHistory: prisma.sitePriceHistory,
  user: prisma.user,
  partnerProfile: prisma.partnerProfile,
  paymentCard: prisma.paymentCard,
  settlement: prisma.settlement,
  refundLog: prisma.refundLog,
  refundAttempt: prisma.refundAttempt,
  csmsVariable: prisma.csmsVariable,
  consumedEvent: prisma.consumedEvent,
  chargeSessionProjection: prisma.chargeSessionProjection,
  pgConfig: prisma.pgConfig,
  paymentOrder: prisma.paymentOrder,

  // — 유틸리티 —
  $transaction: prisma.$transaction.bind(prisma) as typeof prisma.$transaction,
  $queryRaw: prisma.$queryRaw.bind(prisma) as typeof prisma.$queryRaw,
  $executeRaw: prisma.$executeRaw.bind(prisma) as typeof prisma.$executeRaw,
  $queryRawUnsafe: prisma.$queryRawUnsafe.bind(
    prisma,
  ) as typeof prisma.$queryRawUnsafe,
  $executeRawUnsafe: prisma.$executeRawUnsafe.bind(
    prisma,
  ) as typeof prisma.$executeRawUnsafe,
  $disconnect: prisma.$disconnect.bind(prisma) as typeof prisma.$disconnect,
} as const;

/** prismaCore의 타입 (함수 인자 타입 선언 등에 사용) */
export type PrismaCoreClient = typeof prismaCore;

/** prismaPortal의 타입 (함수 인자 타입 선언 등에 사용) */
export type PrismaPortalClient = typeof prismaPortal;
