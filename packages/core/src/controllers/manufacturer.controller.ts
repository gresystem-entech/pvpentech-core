import { Request, Response, NextFunction } from 'express';
import { ManufacturerService } from '@core/services/manufacturer.service';
import {
  createManufacturerSchema,
  updateManufacturerSchema,
  regenerateTokenSchema,
} from '@core/validators/manufacturer.validator';

type ManufacturerRow = Record<string, unknown>;

/** tokenHash 필드를 응답에서 제외하는 헬퍼 */
function omitTokenHash(obj: ManufacturerRow): Omit<ManufacturerRow, 'tokenHash'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tokenHash, ...safe } = obj;
  return safe;
}

export class ManufacturerController {
  constructor(private service: ManufacturerService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const result = await this.service.findAll({ page, limit });
      const items = result.items.map((m) => omitTokenHash(m as ManufacturerRow));
      res.json({ success: true, data: { ...result, items } });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = createManufacturerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: '요청 형식이 올바르지 않습니다.' },
        });
        return;
      }

      const { manufacturer, plainToken, imported } = await this.service.create(parsed.data);
      const safeManufacturer = omitTokenHash(manufacturer as ManufacturerRow);

      res.status(201).json({
        success: true,
        data: { ...safeManufacturer, plainToken, imported },
        notice: imported
          ? '제조사가 제공한 기존 토큰으로 등록되었습니다. 펌웨어와 일치하는지 확인하세요.'
          : 'plainToken은 이 응답에서만 확인 가능합니다. 제조사에 안전하게 전달 후 보관하세요.',
      });
    } catch (error) {
      next(error);
    }
  };

  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const manufacturer = await this.service.findById(Number(req.params.id));
      const safeManufacturer = omitTokenHash(manufacturer as ManufacturerRow);
      res.json({ success: true, data: safeManufacturer });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = updateManufacturerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: '요청 형식이 올바르지 않습니다.' },
        });
        return;
      }
      const manufacturer = await this.service.update(Number(req.params.id), parsed.data);
      const safeManufacturer = omitTokenHash(manufacturer as ManufacturerRow);
      res.json({ success: true, data: safeManufacturer });
    } catch (error) {
      next(error);
    }
  };

  regenerateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = regenerateTokenSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: '요청 형식이 올바르지 않습니다.' },
        });
        return;
      }
      const { plainToken, imported } = await this.service.regenerateToken(
        Number(req.params.id),
        parsed.data.plainToken,
      );
      res.json({
        success: true,
        data: { plainToken, imported },
        notice: imported
          ? '제조사가 제공한 기존 토큰으로 갱신되었습니다. 펌웨어와 일치하는지 확인하세요.'
          : '기존 토큰은 즉시 무효화됩니다. 제조사에 새 토큰을 전달하세요.',
      });
    } catch (error) {
      next(error);
    }
  };

  deactivate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const manufacturer = await this.service.deactivate(Number(req.params.id));
      const safeManufacturer = omitTokenHash(manufacturer as ManufacturerRow);
      res.json({ success: true, data: safeManufacturer });
    } catch (error) {
      next(error);
    }
  };
}
