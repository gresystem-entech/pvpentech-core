#!/bin/bash
set -e

# Pvpentech CSMS Server-Side Deploy Script
# 서버(192.168.0.25)에서 실행되는 배포 스크립트
# GitHub에서 최신 코드를 pull하고 빌드 후 PM2 재시작

APP_DIR="/opt/pvpentech"
APP_NAME="pvpentech-csms"

echo "[1/5] Pulling latest code from GitHub..."
cd "$APP_DIR"
git pull origin main

echo "[2/5] Installing dependencies (including devDependencies for build)..."
npm ci
npx prisma generate

echo "[3/5] Building TypeScript..."
npm run build

echo "  Pruning devDependencies..."
npm prune --omit=dev

echo "[4/5] Running database migrations..."
npx prisma migrate deploy || echo "No pending migrations."

echo "[5/5] Restarting PM2..."
pm2 restart "$APP_NAME" --update-env || pm2 startOrRestart /opt/pvpentech/ecosystem.config.js --env production
pm2 save

echo ""
echo "Deploy complete. Status:"
pm2 status "$APP_NAME"
