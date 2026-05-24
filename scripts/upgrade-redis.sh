#!/bin/bash
# Redis upgrade script for Ubuntu 20.04/22.04
# Upgrades Redis from 6.0.x to 6.2.x+ via Snapcraft or PPA

set -e

echo "=== Redis Upgrade Script ==="
echo "Current Redis version:"
redis-server --version 2>/dev/null || echo "Redis not running"

# Check Ubuntu version
UBUNTU_VERSION=$(lsb_release -rs)
echo "Ubuntu version: $UBUNTU_VERSION"

# Method 1: Use Redis official PPA (Ubuntu 20.04/22.04)
echo "Adding Redis official PPA..."
sudo add-apt-repository -y ppa:redislabs/redis
sudo apt-get update -y

echo "Upgrading Redis..."
sudo apt-get install -y redis-server

echo "Checking upgraded version:"
redis-server --version

# Restart Redis service
echo "Restarting Redis service..."
sudo systemctl restart redis-server
sudo systemctl enable redis-server

echo "Redis service status:"
sudo systemctl status redis-server --no-pager

echo "=== Redis upgrade complete ==="
