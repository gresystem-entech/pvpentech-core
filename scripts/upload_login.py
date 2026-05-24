#!/usr/bin/env python3
import paramiko

HOST = '192.168.0.25'
USER = 'jeongsooh'
PASSWORD = '<YOUR_SSH_PASSWORD>'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
sftp = ssh.open_sftp()
sftp.put('E:/projects/pvpentech/public/portal/login.html', '/opt/pvpentech/public/portal/login.html')
print('login.html uploaded')
sftp.close()
ssh.close()
