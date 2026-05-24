#!/usr/bin/env python3
"""
Deploy portal frontend and admin setup to remote server.
"""
import paramiko
import os
import time
import stat

HOST = '192.168.0.25'
PORT = 22
USER = 'jeongsooh'
PASSWORD = '<YOUR_SSH_PASSWORD>'
REMOTE_DIR = '/opt/pvpentech'
LOCAL_BASE = 'E:/projects/pvpentech'

def run_cmd(ssh, cmd, timeout=60):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    rc = stdout.channel.recv_exit_status()
    return rc, out, err

def sftp_mkdir_p(sftp, remote_dir):
    """Recursively create remote directories."""
    parts = remote_dir.split('/')
    path = ''
    for part in parts:
        if not part:
            path = '/'
            continue
        path = path.rstrip('/') + '/' + part
        try:
            sftp.stat(path)
        except FileNotFoundError:
            sftp.mkdir(path)

def upload_file(sftp, local_path, remote_path):
    """Upload a single file, creating parent dirs as needed."""
    remote_dir = os.path.dirname(remote_path)
    sftp_mkdir_p(sftp, remote_dir)
    sftp.put(local_path, remote_path)
    print(f'  Uploaded: {remote_path}')

def upload_dir(sftp, local_dir, remote_dir):
    """Recursively upload a directory."""
    sftp_mkdir_p(sftp, remote_dir)
    for item in os.listdir(local_dir):
        local_path = os.path.join(local_dir, item)
        remote_path = remote_dir + '/' + item
        if os.path.isdir(local_path):
            upload_dir(sftp, local_path, remote_path)
        else:
            upload_file(sftp, local_path, remote_path)

def main():
    print('Connecting to remote server...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=15)
    print('Connected.')

    sftp = ssh.open_sftp()

    # --- Step 1: Upload dist/app.js ---
    print('\n[1/4] Uploading dist/app.js...')
    local_app = os.path.join(LOCAL_BASE, 'dist', 'app.js').replace('\\', '/')
    remote_app = REMOTE_DIR + '/dist/app.js'
    if os.path.exists(local_app):
        upload_file(sftp, local_app, remote_app)
    else:
        print(f'  WARN: {local_app} not found, skipping')

    # --- Step 2: Upload entire public/ directory ---
    print('\n[2/4] Uploading public/ directory...')
    local_public = os.path.join(LOCAL_BASE, 'public').replace('\\', '/')
    remote_public = REMOTE_DIR + '/public'
    if os.path.isdir(local_public):
        upload_dir(sftp, local_public, remote_public)
        print('  public/ uploaded successfully.')
    else:
        print(f'  WARN: {local_public} not found')

    sftp.close()

    # --- Step 3: Create admin account ---
    print('\n[3/4] Creating admin account...')

    # Write the create_admin script to remote
    create_admin_script = r"""
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('password1234', 10);
  const existing = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (existing) {
    await prisma.user.update({
      where: { username: 'admin' },
      data: { passwordHash: hash, role: 'cs', status: 'active', isActive: true }
    });
    console.log('Admin updated successfully');
  } else {
    await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash: hash,
        email: 'admin@pvpentech.com',
        firstName: '관리자',
        role: 'cs',
        status: 'active',
        isActive: true
      }
    });
    console.log('Admin created successfully');
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
"""
    # Write script to /tmp/create_admin.mjs on remote
    cmd_write = f"cat > /tmp/create_admin.mjs << 'ADMINEOF'\n{create_admin_script}\nADMINEOF"
    rc, out, err = run_cmd(ssh, cmd_write, timeout=10)

    # Run the script from the pvpentech directory with node
    cmd_run = f"cd {REMOTE_DIR} && node -r module-alias/register --input-type=module < /tmp/create_admin.mjs 2>&1 || node --experimental-vm-modules /tmp/create_admin.mjs 2>&1"
    # Try with ts-node or direct node depending on setup
    cmd_run2 = f"cd {REMOTE_DIR} && node -e \"require('module-alias/register'); const {{execSync}} = require('child_process'); execSync('node --input-type=module', {{input: require('fs').readFileSync('/tmp/create_admin.mjs'), stdio: 'inherit'}})\" 2>&1"

    # Simplest approach: run via the dist node process
    cmd_run3 = f"cd {REMOTE_DIR} && node --experimental-modules /tmp/create_admin.mjs 2>&1"
    rc, out, err = run_cmd(ssh, f"cd {REMOTE_DIR} && node /tmp/create_admin.mjs 2>&1", timeout=30)
    if out:
        print(f'  Admin script output: {out}')
    if err:
        print(f'  Admin script stderr: {err}')

    if rc != 0 or 'Error' in out or 'Error' in err:
        # Fallback: try with .mjs extension via --input-type
        print('  Trying ESM mode...')
        rc2, out2, err2 = run_cmd(
            ssh,
            f'cd {REMOTE_DIR} && node --input-type=module < /tmp/create_admin.mjs 2>&1',
            timeout=30
        )
        print(f'  ESM output: {out2}')
        if err2:
            print(f'  ESM stderr: {err2}')

    # --- Step 4: Restart PM2 ---
    print('\n[4/4] Restarting PM2 process...')
    rc, out, err = run_cmd(ssh, 'pm2 restart pvpentech-csms 2>&1', timeout=30)
    print(f'  PM2 output: {out}')
    if err:
        print(f'  PM2 stderr: {err}')

    time.sleep(3)

    # --- Verify server is running ---
    print('\nVerifying server health...')
    rc, out, err = run_cmd(ssh, 'curl -s http://localhost:3000/health 2>&1', timeout=10)
    print(f'  Health check: {out}')

    # Test login redirect
    rc, out, err = run_cmd(ssh, 'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>&1', timeout=10)
    print(f'  Root URL status code: {out}')

    # Test login page exists
    rc, out, err = run_cmd(ssh, 'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/portal/login.html 2>&1', timeout=10)
    print(f'  Login page status code: {out}')

    ssh.close()
    print('\nDone.')

if __name__ == '__main__':
    main()
