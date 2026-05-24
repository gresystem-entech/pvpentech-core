import 'module-alias/register';
import { prisma } from '../src/config/database';
import { logger } from '../src/config/logger';

const CSMS_VARIABLES = [
  { key: 'DEFAULT_UNIT_PRICE_KRW', value: '250', description: '기본 단가 (원/kWh)' },
  { key: 'HEARTBEAT_INTERVAL_SEC', value: '60', description: 'OCPP Heartbeat 간격 (초)' },
  { key: 'SESSION_TIMEOUT_MIN', value: '5', description: '충전 세션 Pending 타임아웃 (분)' },
  { key: 'MAX_CHARGE_DURATION_HR', value: '24', description: '최대 충전 시간 (시간)' },
  { key: 'OCPP_RESPONSE_TIMEOUT_SEC', value: '30', description: 'OCPP 응답 대기 타임아웃 (초)' },
  { key: 'LOG_RETENTION_DAYS', value: '30', description: 'OCPP 메시지 로그 보관 기간 (일)' },
];

async function seed(): Promise<void> {
  logger.info('Starting database seed...');

  // Initialize StationIdSequence
  const existingSeq = await prisma.stationIdSequence.findFirst();
  if (!existingSeq) {
    await prisma.stationIdSequence.create({ data: { currentValue: 1000000 } });
    logger.info('StationIdSequence initialized at 1000000');
  } else {
    logger.info({ currentValue: existingSeq.currentValue }, 'StationIdSequence already exists');
  }

  // Upsert CsmsVariables
  for (const variable of CSMS_VARIABLES) {
    await prisma.csmsVariable.upsert({
      where: { key: variable.key },
      update: { description: variable.description },
      create: variable,
    });
    logger.info({ key: variable.key, value: variable.value }, 'Upserted CsmsVariable');
  }

  logger.info('Database seed completed');
}

seed()
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
