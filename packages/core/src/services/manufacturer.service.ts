import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { ManufacturerRepository } from '@core/repositories/manufacturer.repository';
import { ConflictError, NotFoundError } from '@pvpentech/shared/errors';
import { logger } from '@pvpentech/shared/config/logger';

const BCRYPT_ROUNDS = 12;

function generateRandomToken(): string {
  return crypto.randomBytes(32).toString('hex'); // 64자 hex (256-bit)
}

export class ManufacturerService {
  constructor(private repo: ManufacturerRepository) {}

  /**
   * 제조사 등록.
   *  - data.plainToken 미지정 → 서버가 64자 hex 랜덤 토큰 신규 발급 (default)
   *  - data.plainToken 지정    → 그 값을 그대로 해시해 저장 (firmware-imported)
   * 응답의 plainToken은 항상 1회만 반환되며, 이후 복원 불가.
   */
  async create(data: {
    channelId: string;
    name: string;
    plainToken?: string;
  }): Promise<{ manufacturer: object; plainToken: string; imported: boolean }> {
    const existing = await this.repo.findByChannelId(data.channelId);
    if (existing) {
      throw new ConflictError(
        `channelId '${data.channelId}'가 이미 사용 중입니다.`,
        'manufacturer:channelInUse',
      );
    }

    const imported = !!data.plainToken;
    const plainToken = data.plainToken ?? generateRandomToken();
    const tokenHash = await bcrypt.hash(plainToken, BCRYPT_ROUNDS);

    const manufacturer = await this.repo.create({
      channelId: data.channelId,
      name: data.name,
      tokenHash,
      isActive: true,
    });

    logger.info(
      { channelId: data.channelId, id: manufacturer.id, imported },
      'Manufacturer created',
    );

    return { manufacturer, plainToken, imported };
  }

  /**
   * 토큰 재발급. 기존 tokenHash를 새 값으로 즉시 교체.
   *  - plainToken 미지정 → 서버가 새 랜덤 토큰 발급
   *  - plainToken 지정   → 그 값으로 갱신 (firmware-imported)
   */
  async regenerateToken(
    id: number,
    plainTokenInput?: string,
  ): Promise<{ plainToken: string; imported: boolean }> {
    const manufacturer = await this.repo.findById(id);
    if (!manufacturer) {
      throw new NotFoundError('제조사를 찾을 수 없습니다.', 'manufacturer:notFound');
    }

    const imported = !!plainTokenInput;
    const plainToken = plainTokenInput ?? generateRandomToken();
    const tokenHash = await bcrypt.hash(plainToken, BCRYPT_ROUNDS);

    await this.repo.update(id, { tokenHash });

    logger.info(
      { id, channelId: manufacturer.channelId, imported },
      'Manufacturer token regenerated',
    );

    return { plainToken, imported };
  }

  async findAll(params: { page: number; limit: number }) {
    const [items, total] = await this.repo.findAll(params);
    const { page, limit } = params;
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: number) {
    const manufacturer = await this.repo.findById(id);
    if (!manufacturer) {
      throw new NotFoundError('제조사를 찾을 수 없습니다.', 'manufacturer:notFound');
    }
    return manufacturer;
  }

  async update(id: number, data: { name?: string; isActive?: boolean }) {
    const manufacturer = await this.repo.findById(id);
    if (!manufacturer) {
      throw new NotFoundError('제조사를 찾을 수 없습니다.', 'manufacturer:notFound');
    }
    return this.repo.update(id, data);
  }

  /**
   * 소프트 삭제 — isActive=false로 변경
   * 이후 해당 channelId의 /auths 요청은 모두 401
   */
  async deactivate(id: number) {
    const manufacturer = await this.repo.findById(id);
    if (!manufacturer) {
      throw new NotFoundError('제조사를 찾을 수 없습니다.', 'manufacturer:notFound');
    }
    return this.repo.update(id, { isActive: false });
  }
}

export const manufacturerService = new ManufacturerService(
  new ManufacturerRepository()
);
