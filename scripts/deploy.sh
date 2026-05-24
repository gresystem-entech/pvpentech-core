#!/bin/bash
set -e

# Pvpentech CSMS Deploy Script (GitHub Pull 방식)
# 로컬에서 실행: ./scripts/deploy.sh
# 서버에서 git pull + 빌드 + PM2 재시작

REMOTE_HOST="192.168.0.25"
REMOTE_USER="jeongsooh"
REMOTE_PASS="<YOUR_SSH_PASSWORD>"
APP_NAME="pvpentech-csms"

echo "=========================================="
echo "  Pvpentech CSMS Deployment"
echo "  Target: ${REMOTE_USER}@${REMOTE_HOST}"
echo "=========================================="

plink -pw "$REMOTE_PASS" -batch "${REMOTE_USER}@${REMOTE_HOST}" "bash /opt/pvpentech/scripts/server-deploy.sh"

echo ""
echo "=========================================="
echo "  Deployment triggered."
echo "  Check status: plink -pw <YOUR_SSH_PASSWORD> -batch jeongsooh@192.168.0.25 'pm2 status'"
echo "=========================================="
