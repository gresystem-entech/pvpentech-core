import crypto from 'crypto';

export function generateRandomPassword(length: number): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}
