import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { firmwareRepository, FirmwareRepository } from '@core/repositories/firmware.repository';
import { env } from '@pvpentech/shared/config/env';
import { logger } from '@pvpentech/shared/config/logger';
import { ConflictError, NotFoundError, BadRequestError } from '@pvpentech/shared/errors';

interface UploadParams {
  buffer: Buffer;
  originalName: string;
  version: string;
  chargerModel?: string;
  chargerVendor?: string;
  uploadedBy: string;
  notes?: string;
}

/**
 * 펌웨어 마스터 관리 (REQ-FW-002).
 *
 * 저장 위치: `env.FIRMWARE_STORAGE_DIR`
 * 다운로드 URL: `env.FIRMWARE_BASE_URL` + `/<filename>`
 * 파일명: `<sha256-prefix>-<original>` 형식 (충돌 방지 + 디버그 용이)
 */
export class FirmwareService {
  constructor(private repo: FirmwareRepository) {}

  /**
   * 펌웨어 업로드.
   *  - SHA256 계산 → 동일 바이너리 재업로드 방지 (409)
   *  - 디스크에 저장 → DB 메타 INSERT
   *  - DB 실패 시 이미 저장한 파일 롤백 삭제
   */
  async upload(params: UploadParams) {
    const { buffer, originalName, version, chargerModel, chargerVendor, uploadedBy, notes } = params;

    if (buffer.length === 0) {
      throw new BadRequestError('빈 파일은 업로드할 수 없습니다.', 'firmware:emptyFile');
    }
    const maxBytes = env.FIRMWARE_MAX_SIZE_MB * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new BadRequestError(
        `파일 크기가 한도(${env.FIRMWARE_MAX_SIZE_MB}MB)를 초과합니다.`,
        'firmware:fileTooLarge',
      );
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const existing = await this.repo.findBySha256(sha256);
    if (existing) {
      throw new ConflictError(
        `동일한 바이너리가 이미 등록되어 있습니다 (id=${existing.id}, version=${existing.version})`,
        'firmware:duplicateBinary',
      );
    }

    // 파일명: <sha256_prefix>-<sanitized_original>
    const sanitized = originalName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
    const filename = `${sha256.slice(0, 12)}-${sanitized}`;

    await fs.mkdir(env.FIRMWARE_STORAGE_DIR, { recursive: true });
    const targetPath = path.resolve(env.FIRMWARE_STORAGE_DIR, filename);
    await fs.writeFile(targetPath, buffer);

    try {
      const record = await this.repo.create({
        filename,
        originalName,
        version,
        chargerModel: chargerModel ?? null,
        chargerVendor: chargerVendor ?? null,
        fileSize: buffer.length,
        sha256,
        uploadedBy,
        notes: notes ?? null,
      });
      logger.info({ id: record.id, filename, version, sha256 }, 'Firmware uploaded');
      return record;
    } catch (err) {
      // DB 실패 → 디스크에 저장된 파일 롤백
      await fs.unlink(targetPath).catch(() => {});
      throw err;
    }
  }

  async findById(id: number) {
    const fw = await this.repo.findById(id);
    if (!fw) throw new NotFoundError('펌웨어를 찾을 수 없습니다.', 'firmware:notFound');
    return fw;
  }

  async list(params: { page: number; limit: number; isActive?: boolean }) {
    const [items, total] = await this.repo.findAll(params);
    const { page, limit } = params;
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async update(id: number, data: { version?: string; chargerModel?: string; chargerVendor?: string; isActive?: boolean; notes?: string }) {
    await this.findById(id);
    return this.repo.update(id, data);
  }

  /**
   * 삭제. 캠페인 사용 이력이 있으면 거부 (이력 추적 보존).
   */
  async delete(id: number) {
    const fw = await this.findById(id);
    const campaignCount = await this.repo.countCampaignsForFirmware(id);
    if (campaignCount > 0) {
      throw new ConflictError(
        `이 펌웨어로 시작된 캠페인이 ${campaignCount}건 있어 삭제할 수 없습니다. 비활성화(isActive=false) 처리하세요.`,
        'firmware:hasCampaigns',
      );
    }

    // DB 먼저 → 디스크 삭제 (DB 보존이 우선)
    await this.repo.delete(id);
    const filePath = path.resolve(env.FIRMWARE_STORAGE_DIR, fw.filename);
    await fs.unlink(filePath).catch((err) => {
      logger.warn({ id, filename: fw.filename, err }, 'Failed to delete firmware file from disk');
    });
    logger.info({ id, filename: fw.filename }, 'Firmware deleted');
    return { id, deleted: true };
  }

  /**
   * 충전기에 전달할 다운로드 URL 조립.
   * REQ-FW-001: 호스트는 환경변수, 경로는 실제 파일명.
   */
  buildDownloadUrl(filename: string): string {
    return `${env.FIRMWARE_BASE_URL.replace(/\/$/, '')}/${encodeURIComponent(filename)}`;
  }

  /**
   * 파일 스트리밍용 절대 경로 (다운로드 라우트에서 사용).
   */
  getAbsolutePath(filename: string): string {
    return path.resolve(env.FIRMWARE_STORAGE_DIR, filename);
  }
}

export const firmwareService = new FirmwareService(firmwareRepository);
