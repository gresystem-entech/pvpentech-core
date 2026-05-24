/**
 * Firmware 전체 정리 스크립트 (순수 JS — ts-node 불필요)
 *
 * 디스크에서 펌웨어 파일을 수동 삭제한 뒤 DB 잔여 레코드를 일괄 정리할 때 사용.
 *
 * 실행:
 *   서버에서:  node scripts/purgeFirmware.js
 *   드라이런:  node scripts/purgeFirmware.js --dry-run
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const firmwareList = await prisma.firmware.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, filename: true, version: true, uploadedAt: true },
  });
  const campaignCount = await prisma.firmwareCampaign.count();
  const progressCount = await prisma.firmwareCampaignProgress.count();

  console.log('=== 현재 상태 ===');
  console.log(`firmware                    : ${firmwareList.length} 건`);
  console.log(`firmware_campaign           : ${campaignCount} 건`);
  console.log(`firmware_campaign_progress  : ${progressCount} 건`);
  console.log('');
  if (firmwareList.length === 0) {
    console.log('삭제할 firmware 레코드가 없습니다.');
    return;
  }
  console.log('=== 삭제 대상 firmware ===');
  for (const fw of firmwareList) {
    console.log(`  id=${fw.id}  version=${fw.version}  file=${fw.filename}  uploadedAt=${fw.uploadedAt.toISOString()}`);
  }
  console.log('');

  if (dryRun) {
    console.log('[dry-run] 실제 삭제는 수행하지 않습니다.');
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const deletedCampaigns = await tx.firmwareCampaign.deleteMany({});
    const deletedFirmware = await tx.firmware.deleteMany({});
    return { deletedCampaigns: deletedCampaigns.count, deletedFirmware: deletedFirmware.count };
  });

  console.log('=== 삭제 완료 ===');
  console.log(`firmware_campaign 삭제      : ${result.deletedCampaigns} 건 (progress 는 cascade 삭제)`);
  console.log(`firmware 삭제               : ${result.deletedFirmware} 건`);
}

main()
  .catch((err) => {
    console.error('[purgeFirmware] error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
