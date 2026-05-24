/**
 * ecosystem.config.js — pm2 프로세스 관리 설정
 *
 * Phase 2-E 이후 프로덕션 배포는 Core / Portal 두 프로세스로 분리된다.
 *
 * 배포 방법:
 *   pm2 start ecosystem.config.js --env production
 *
 * 레거시 단일 프로세스 (개발/마이그레이션 fallback):
 *   pm2 start ecosystem.config.js --only pvpentech-legacy --env production
 */
module.exports = {
  apps: [
    // ─────────────────────────────────────────────
    // Core 서버 — OCPP WebSocket + Internal API + Outbox Relay + Core Jobs
    // ─────────────────────────────────────────────
    {
      name: 'pvpentech-core',
      script: 'node',
      args: '-r module-alias/register apps/server/dist/apps/core-server/src/index.js',
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
    // ─────────────────────────────────────────────
    // Portal 서버 — REST API + Stream Consumer + Portal Jobs
    // ─────────────────────────────────────────────
    {
      name: 'pvpentech-portal',
      script: 'node',
      args: '-r module-alias/register apps/server/dist/apps/portal-server/src/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORTAL_PORT: 3002,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/portal-error.log',
      out_file: 'logs/portal-out.log',
      merge_logs: true,
      time: true,
    },
    // ─────────────────────────────────────────────
    // Legacy 통합 서버 — 개발/통합 테스트/마이그레이션 fallback
    // (Core + Portal 단일 프로세스)
    // ─────────────────────────────────────────────
    {
      name: 'pvpentech-legacy',
      script: 'node',
      args: '-r module-alias/register apps/server/dist/apps/server/src/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        CORE_PORT: 3001,
        PORTAL_PORT: 3002,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/legacy-error.log',
      out_file: 'logs/legacy-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
