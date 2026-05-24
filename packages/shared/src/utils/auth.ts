import { Buffer } from 'buffer';
import { prisma } from '../config/database';
import { comparePassword } from './password';

export async function verifyOcppBasicAuth(
  stationId: string,
  authHeader: string | undefined
): Promise<boolean> {
  // DB에서 충전기 조회
  const station = await prisma.chargingStation.findUnique({
    where: { id: stationId },
    select: { passwordHash: true },
  });

  // 존재하지 않는 충전기는 거부
  if (!station) return false;

  // passwordHash가 없는 경우: 인증 없이 접속 허용 (개방형 모드)
  if (!station.passwordHash) return true;

  // passwordHash가 설정된 경우: Basic Auth 필수 검증
  if (!authHeader?.startsWith('Basic ')) return false;

  const encoded = authHeader.slice(6);
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) return false;

  const id = decoded.substring(0, colonIndex);
  const password = decoded.substring(colonIndex + 1);

  if (id !== stationId) return false;

  return comparePassword(password, station.passwordHash);
}

export function parsePagination(
  page: unknown,
  limit: unknown
): { page: number; limit: number; skip: number } {
  const p = Math.max(1, parseInt(String(page || '1'), 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(String(limit || '20'), 10) || 20));
  return { page: p, limit: l, skip: (p - 1) * l };
}
