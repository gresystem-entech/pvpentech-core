import { Request, Response, NextFunction } from 'express';
import * as fs from 'node:fs';
import { firmwareService } from '@core/services/firmware.service';
import { firmwareCampaignService, CampaignTargetFilter } from '@core/services/firmwareCampaign.service';
import {
  uploadFirmwareSchema,
  updateFirmwareSchema,
  startCampaignSchema,
} from '@core/validators/firmware.validator';
import { BadRequestError, NotFoundError } from '@pvpentech/shared/errors';

export class FirmwareController {
  // ─── 펌웨어 마스터 ────────────────────────────

  upload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        throw new BadRequestError('업로드 파일이 누락되었습니다.', 'firmware:fileMissing');
      }
      const parsed = uploadFirmwareSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'invalid' },
        });
        return;
      }

      const username = req.user?.username ?? 'unknown';
      const fw = await firmwareService.upload({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        version: parsed.data.version,
        chargerModel: parsed.data.chargerModel,
        chargerVendor: parsed.data.chargerVendor,
        uploadedBy: username,
        notes: parsed.data.notes,
      });
      res.status(201).json({ success: true, data: fw });
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const isActive = req.query.isActive === undefined ? undefined : req.query.isActive === 'true';
      const result = await firmwareService.list({ page, limit, isActive });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const fw = await firmwareService.findById(Number(req.params.id));
      res.json({ success: true, data: fw });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = updateFirmwareSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'invalid' },
        });
        return;
      }
      const fw = await firmwareService.update(Number(req.params.id), parsed.data);
      res.json({ success: true, data: fw });
    } catch (err) {
      next(err);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await firmwareService.delete(Number(req.params.id));
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * 충전기가 UpdateFirmware.location 으로 받은 URL 로 GET 했을 때 펌웨어 바이너리 스트리밍.
   * (REQ-FW-001 의 다운로드 위치)
   */
  download = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filename = req.params.filename;
      // 디렉토리 트래버설 방지
      if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\\')) {
        throw new BadRequestError('잘못된 파일명입니다.', 'firmware:invalidFilename');
      }
      const fw = await import('@pvpentech/shared/config/database').then(({ prisma }) =>
        prisma.firmware.findUnique({ where: { filename } }),
      );
      if (!fw) throw new NotFoundError('펌웨어를 찾을 수 없습니다.', 'firmware:notFound');

      const absPath = firmwareService.getAbsolutePath(fw.filename);
      if (!fs.existsSync(absPath)) {
        throw new NotFoundError('펌웨어 파일이 디스크에 없습니다.', 'firmware:fileMissing');
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(fw.fileSize));
      res.setHeader('Content-Disposition', `attachment; filename="${fw.originalName}"`);
      res.setHeader('X-Firmware-SHA256', fw.sha256);
      fs.createReadStream(absPath).pipe(res);
    } catch (err) {
      next(err);
    }
  };

  // ─── 캠페인 ──────────────────────────────────

  startCampaign = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = startCampaignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'invalid' },
        });
        return;
      }
      const username = req.user?.username ?? 'unknown';
      const campaign = await firmwareCampaignService.start({
        firmwareId: Number(req.params.id),
        targetFilter: parsed.data.targetFilter as CampaignTargetFilter,
        startedBy: username,
        notes: parsed.data.notes,
      });
      res.status(201).json({ success: true, data: campaign });
    } catch (err) {
      next(err);
    }
  };

  listCampaigns = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const status = req.query.status ? String(req.query.status) : undefined;
      const firmwareId = req.query.firmwareId ? Number(req.query.firmwareId) : undefined;
      const result = await firmwareCampaignService.list({ page, limit, status, firmwareId });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  campaignDetail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const c = await firmwareCampaignService.findById(Number(req.params.id));
      res.json({ success: true, data: c });
    } catch (err) {
      next(err);
    }
  };

  cancelCampaign = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await firmwareCampaignService.cancel(Number(req.params.id));
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };
}

export const firmwareController = new FirmwareController();
