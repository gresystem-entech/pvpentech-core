#!/usr/bin/env python3
"""Test login API with admin credentials."""
import paramiko

HOST = '192.168.0.25'
USER = 'jeongsooh'
PASSWORD = '<YOUR_SSH_PASSWORD>'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)

cmd = """curl -s -X POST http://localhost:3000/api/portal/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"password1234"}' 2>&1"""

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
out = stdout.read().decode('utf-8', errors='replace').strip()
err = stderr.read().decode('utf-8', errors='replace').strip()
print('Login response:', out)
if err:
    print('stderr:', err)

ssh.close()
