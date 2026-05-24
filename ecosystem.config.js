/**
 * ecosystem.config.js — pm2 프로세스 관리 설정 (pvpentech-core)
 *
 * Phase 4-B: Core 전용 프로세스만 포함.
 * Portal 서버는 pvpentech-portal 리포의 ecosystem.config.js 참조.
 *
 * 배포 방법:
 *   pm2 start ecosystem.config.js --env production
 */
module.exports = {
  apps: [
    {
      name: 'pvpentech-core',
      script: 'node',
      args: '-r module-alias/register dist/apps/core-server/src/index.js',
      instances: 1,       // OCPP WebSocket 상태 공유 이슈로 단일 인스턴스 필수
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        CORE_PORT: 3001,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/core-error.log',
      out_file: 'logs/core-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
