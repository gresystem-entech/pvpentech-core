import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProvisionService } from '@core/services/provision.service';
import { ForbiddenError, ConflictError, NotFoundError } from '@pvpentech/shared/errors';

const provisionSchema = z.object({
  serial_number: z.string().min(1).max(100),
});

const registerSchema = z.object({
  serialNumber: z.string().min(1).max(100),
  modelName: z.string().max(100).optional(),
  clientId: z.string().max(50).optional(),
  siteId: z.number().int().positive().optional(),
  // v2.0: 제조사 매핑 (신규 등록 시 필수 권장)
  manufacturerId: z.number().int().positive().optional(),
  // v2.1: 시간당 충전용량 (kWh/h)
  chargingKwh: z.number().nonnegative().max(9999.99).optional(),
});

const updateSchema = z.object({
  serialNumber: z.string().min(1).max(100).optional(),
  rejectReason: z.string().optional(),
  // v2.1: 시간당 충전용량 (kWh/h)
  chargingKwh: z.number().nonnegative().max(9999.99).optional(),
});

export class ProvisionController {
  constructor(private provisionService: ProvisionService) {}

  provision = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { serial_number } = provisionSchema.parse(req.body);
      const result = await this.provisionService.provision(serial_number);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { serialNumber, modelName, clientId, siteId, manufacturerId, chargingKwh } = registerSchema.parse(req.body);
      const record = await this.provisionService.register(
        serialNumber,
        req.user?.username || 'unknown',
        modelName,
        clientId,
        siteId,
        manufacturerId,
        chargingKwh,
      );
      res.status(201).json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.provisionService.list({
        status: req.query.status as string,
        keyword: req.query.keyword as string,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { serialNumber, rejectReason, chargingKwh } = updateSchema.parse(req.body);
      const record = await this.provisionService.update(Number(req.params.id), { serialNumber, rejectReason, chargingKwh });
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  };

  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const record = await this.provisionService.findById(Number(req.params.id));
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  };

  revoke = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const record = await this.provisionService.revoke(Number(req.params.id));
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.provisionService.delete(Number(req.params.id));
      res.json({ success: true, data: { message: '프로비저닝 레코드가 삭제되었습니다.' } });
    } catch (error) {
      next(error);
    }
  };

  chargerAuth = async (req: Request, res: Response): Promise<void> => {
    // KST 타임스탬프 (YYYY-MM-DD HH:mm:ss) — 제조사 프로토콜 요구사항으로 Asia/Seoul 고정.
    // timeZone 인자를 명시하므로 서버 OS TZ와 무관하게 결정적으로 동작한다.
    // 운영 TZ 변경이 필요하면 env.TIMEZONE 연동을 검토할 것.
    const timestamp = new Date().toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).replace(/\. /g, '-').replace(/\./g, '').replace(/(\d{4})-(\d{2})-(\d{2})/, '$1-$2-$3');

    // v2.0: model 필수화
    const schema = z.object({
      origin: z.string().min(1).max(100),
      model: z.string().min(1).max(100),
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        code: 400,
        status: 'Bad Request',
        message: req.t ? req.t('provisioning:invalidBody') : '요청 형식이 올바르지 않습니다.',
        timestamp,
        errors: null,
      });
      return;
    }

    const { origin, model } = parseResult.data;
    // manufacturerAuth 미들웨어에서 주입된 제조사 정보
    const manufacturerId = req.manufacturer?.id;

    try {
      const result = await this.provisionService.provision(origin, model, manufacturerId);

      res.json({
        code: 200,
        status: 'OK',
        message: req.t ? req.t('provisioning:provisionSuccess') : '프로비저닝이 완료되었습니다.',
        timestamp,
        data: {
          clientId: result.station_id,
          pwd: result.password,
          wsUrl: result.csms_server,
        },
      });
    } catch (error: unknown) {
      if (error instanceof ForbiddenError) {
        res.status(401).json({
          code: 401,
          status: 'Unauthorized',
          message: req.t ? req.t('provisioning:provisionRejected') : '등록되지 않은 충전기입니다.',
          timestamp,
          errors: null,
        });
      } else if (error instanceof ConflictError) {
        res.status(409).json({
          code: 409,
          status: 'Conflict',
          message: req.t ? req.t('provisioning:alreadyProvisioned') : '이미 프로비저닝이 완료된 충전기입니다.',
          timestamp,
          errors: null,
        });
      } else if (error instanceof NotFoundError) {
        res.status(404).json({
          code: 404,
          status: 'Not Found',
          message: req.t ? req.t('provisioning:provisionRejected') : '등록되지 않은 충전기입니다.',
          timestamp,
          errors: null,
        });
      } else {
        res.status(500).json({
          code: 500,
          status: 'Internal Server Error',
          message: '서버 내부 오류가 발생하였습니다.',
          timestamp,
          errors: null,
        });
      }
    }
  };
}
