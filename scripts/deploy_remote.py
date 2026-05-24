#!/usr/bin/env python3
"""
Pvpentech CSMS Remote Deployment Script
Uses paramiko for password-based SSH (no sshpass needed)
"""

import paramiko
import os
import sys
import tarfile
import tempfile
import time

HOST = "192.168.0.25"
USER = "jeongsooh"
PASSWORD = "<YOUR_SSH_PASSWORD>"
REMOTE_DIR = "/opt/pvpentech"
LOCAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXCLUDE_PATTERNS = {
    'node_modules', '.git', 'dist', '.env', '__pycache__',
    '*.pyc', '.DS_Store', 'logs'
}


def run_cmd(ssh, cmd, sudo=False, timeout=120):
    if sudo:
        cmd = f'echo "{PASSWORD}" | sudo -S bash -c \'{cmd}\''
    print(f"  $ {cmd[:80]}...")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    exit_code = stdout.channel.recv_exit_status()
    if out:
        print(f"    {out[:200]}")
    if err and exit_code != 0:
        print(f"    ERR: {err[:200]}")
    return out, err, exit_code


def should_exclude(path):
    parts = path.replace('\\', '/').split('/')
    for part in parts:
        if part in EXCLUDE_PATTERNS:
            return True
    return False


def create_tarball():
    tmp = tempfile.NamedTemporaryFile(suffix='.tar.gz', delete=False)
    tmp.close()
    print(f"[1/6] Creating tarball: {tmp.name}")
    with tarfile.open(tmp.name, 'w:gz') as tar:
        for root, dirs, files in os.walk(LOCAL_DIR):
            # Filter dirs in-place
            dirs[:] = [d for d in dirs if not should_exclude(os.path.join(root, d).replace(LOCAL_DIR, ''))]
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, LOCAL_DIR)
                if not should_exclude(rel_path) and not rel_path.endswith('.py.bak'):
                    tar.add(full_path, arcname=rel_path)
    size_mb = os.path.getsize(tmp.name) / (1024 * 1024)
    print(f"    Tarball size: {size_mb:.2f} MB")
    return tmp.name


def main():
    print("=" * 60)
    print("  Pvpentech CSMS Deployment")
    print(f"  Target: {USER}@{HOST}:{REMOTE_DIR}")
    print("=" * 60)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
    print("SSH connected.")

    sftp = ssh.open_sftp()

    # Step 1: Create tarball
    tarball = create_tarball()

    try:
        # Step 2: Ensure remote directory exists
        print("[2/6] Preparing remote directory...")
        run_cmd(ssh, f"mkdir -p {REMOTE_DIR}", sudo=True)
        run_cmd(ssh, f"chown {USER}:{USER} {REMOTE_DIR}", sudo=True)

        # Step 3: Upload tarball
        remote_tar = f"/tmp/pvpentech_deploy_{int(time.time())}.tar.gz"
        print(f"[3/6] Uploading tarball to {remote_tar}...")
        sftp.put(tarball, remote_tar)
        print("    Upload complete.")

        # Step 4: Extract
        print(f"[4/6] Extracting to {REMOTE_DIR}...")
        out, err, code = run_cmd(ssh, f"tar -xzf {remote_tar} -C {REMOTE_DIR} && rm {remote_tar}")
        if code != 0:
            print(f"ERROR: Extraction failed: {err}")
            sys.exit(1)

        # Step 5: Check Node.js
        print("[5/6] Checking Node.js installation...")
        out, _, code = run_cmd(ssh, "bash -lc 'node --version 2>/dev/null || echo MISSING'")
        if "MISSING" in out or code != 0:
            print("    Node.js not found. Installing Node.js 20 LTS...")
            run_cmd(ssh, "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -", sudo=False, timeout=120)
            run_cmd(ssh, "apt-get install -y nodejs", sudo=True, timeout=120)
            out, _, _ = run_cmd(ssh, "node --version")
            print(f"    Node.js installed: {out}")
        else:
            print(f"    Node.js: {out}")

        # Check PM2
        out, _, code = run_cmd(ssh, "bash -lc 'pm2 --version 2>/dev/null || echo MISSING'")
        if "MISSING" in out or code != 0:
            print("    Installing PM2...")
            run_cmd(ssh, "npm install -g pm2", sudo=True, timeout=60)

        # Step 6: Install dependencies and setup
        print("[6/6] Setting up application...")

        # Create .env if it doesn't exist
        out, _, _ = run_cmd(ssh, f"test -f {REMOTE_DIR}/.env && echo EXISTS || echo MISSING")
        if "MISSING" in out:
            print("    Creating .env from .env.example...")
            run_cmd(ssh, f"cp {REMOTE_DIR}/.env.example {REMOTE_DIR}/.env")
            print("    NOTE: Please edit /opt/pvpentech/.env with production values!")

        # npm install
        print("    Installing npm dependencies...")
        run_cmd(ssh, f"cd {REMOTE_DIR} && npm install", timeout=300)

        # Generate Prisma client
        print("    Generating Prisma client...")
        run_cmd(ssh, f"cd {REMOTE_DIR} && npx prisma generate", timeout=60)

        # Create logs directory
        run_cmd(ssh, f"mkdir -p {REMOTE_DIR}/logs")

        # Try to run migrations (may fail if DB not configured)
        print("    Running database migrations (if DB is configured)...")
        out, err, code = run_cmd(ssh, f"cd {REMOTE_DIR} && npx prisma migrate deploy 2>&1 || echo MIGRATION_SKIPPED")
        if "MIGRATION_SKIPPED" in out or code != 0:
            print("    Migration skipped (DB not configured or migration failed — configure .env first)")
        else:
            # Run seed
            print("    Running seed...")
            run_cmd(ssh, f"cd {REMOTE_DIR} && npx ts-node -r tsconfig-paths/register scripts/seed.ts || true", timeout=30)

        # Start/restart PM2
        print("    Starting PM2...")
        out, err, code = run_cmd(ssh, f"bash -lc 'cd {REMOTE_DIR} && pm2 startOrRestart ecosystem.config.js --env production && pm2 save'")
        if code != 0:
            print(f"    PM2 start failed (may need .env configured): {err[:100]}")
        else:
            print("    PM2 started successfully!")

        print("\n" + "=" * 60)
        print("  Deployment complete!")
        print(f"  Check status: ssh {USER}@{HOST} 'pm2 status'")
        print(f"  View logs: ssh {USER}@{HOST} 'pm2 logs pvpentech-csms'")
        print(f"  Edit config: ssh {USER}@{HOST} 'nano {REMOTE_DIR}/.env'")
        print("=" * 60)

    finally:
        os.unlink(tarball)
        sftp.close()
        ssh.close()


if __name__ == '__main__':
    main()
