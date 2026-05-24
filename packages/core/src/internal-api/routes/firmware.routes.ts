/**
 * Internal API — 펌웨어 관리 라우트 (Phase 2-B, B7)
 *
 * 기존 firmwareService, firmwareCampaignService 활용.
 * 파일 업로드: multer(메모리 버퍼) 사용.
 *
 * | 메서드 | 경로 |
 * |--------|------|
 * | POST | /firmware/upload |
 * | GET | /firmware |
 * | POST | /firmware/campaigns |
 * | GET | /firmware/campaigns/:id |
 * | DELETE | /firmware/campaigns/:id |
 * | POST | /stations/:stationId/firmware/update |
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { firmwareService } from '@core/services/firmware.service';
import { firmwareCampaignService, CampaignTargetFilter } from '@core/services/firmwareCampaign.service';
import { ocppGateway } from '@core/ocpp/gateway.impl';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';
import { env } from '@pvpentech/shared/config/env';
import { uploadFirmwareSchema, updateFirmwareSchema, startCampaignSchema } from '@core/validators/firmware.validator';

const router = Router();

// multer — 메모리 버퍼 (디스크 저장은 firmwareService.upload 가 담당)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.FIRMWARE_MAX_SIZE_MB * 1024 * 1024 },
});

// ─── POST /firmware/upload ────────────────────────────────────────────────────

router.post('/upload', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw InternalApiErrors.badRequest('file is required (multipart/form-data field: file)');
    }

    const parsed = uploadFirmwareSchema.safeParse(req.body);
    if (!parsed.success) {
      throw InternalApiErrors.badRequest(parsed.error.errors[0]?.message ?? 'invalid request body');
    }

    const fw = await firmwareService.upload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      version: parsed.data.version,
      chargerModel: parsed.data.chargerModel,
      chargerVendor: parsed.data.chargerVendor,
      uploadedBy: 'internal-api',
      notes: parsed.data.notes,
    });

    res.status(201).json({ success: true, data: fw });
  } catch (err) {
    next(err);
  }
});

// ─── GET /firmware — 목록 ────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const isActive = req.query.isActive === undefined ? undefined : req.query.isActive === 'true';

    const result = await firmwareService.list({ page, limit, isActive });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ─── POST /firmware/campaigns — 캠페인 시작 ──────────────────────────────────

router.post('/campaigns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { firmwareId, targetFilter, notes } = req.body as {
      firmwareId?: number;
      targetFilter?: unknown;
      notes?: string;
    };

    if (!firmwareId) {
      throw InternalApiErrors.badRequest('firmwareId is required');
    }

    // targetFilter 검증 — 기존 validator 활용
    const parsed = startCampaignSchema.safeParse({ targetFilter, notes });
    if (!parsed.success) {
      throw InternalApiErrors.badRequest(parsed.error.errors[0]?.message ?? 'invalid targetFilter');
    }

    const campaign = await firmwareCampaignService.start({
      firmwareId,
      targetFilter: parsed.data.targetFilter as CampaignTargetFilter,
      startedBy: 'internal-api',
      notes: parsed.data.notes,
    });

    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    next(err);
  }
});

// ─── GET /firmware/campaigns/:id — 캠페인 상세 ──────────────────────────────

router.get('/campaigns/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = await firmwareCampaignService.findById(Number(req.params.id));
    res.json({ success: true, data: campaign });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /firmware/campaigns/:id — 캠페인 취소 ────────────────────────────

router.delete('/campaigns/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await firmwareCampaignService.cancel(Number(req.params.id));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ─── POST /stations/:stationId/firmware/update — 단일 충전기 펌웨어 업데이트 ──
// 이 라우트는 /stations 아래 마운트 시 사용됨 → 실제 경로: /stations/:stationId/firmware/update
// firmwareRouter 내부에서 별도 처리하기 위해 express 파라미터 mergeParams 사용

const stationFirmwareRouter = Router({ mergeParams: true });

stationFirmwareRouter.post('/update', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params as { stationId: string };

    // 충전기 존재 여부 확인
    const station = await prisma.chargingStation.findUnique({
      where: { id: stationId },
      select: { id: true },
    });

    if (!station) {
      throw InternalApiErrors.stationNotFound(stationId);
    }

    if (!ocppGateway.isStationConnected(stationId)) {
      throw InternalApiErrors.stationOffline(stationId);
    }

    const { firmwareId, retrieveDate, retries } = req.body as {
      firmwareId?: number;
      retrieveDate?: string;
      retries?: number;
    };

    let location: string;
    if (firmwareId) {
      const fw = await firmwareService.findById(firmwareId);
      location = firmwareService.buildDownloadUrl(fw.filename);
    } else if (req.body.location) {
      location = String(req.body.location);
    } else {
      throw InternalApiErrors.badRequest('firmwareId or location is required');
    }

    const result = await ocppGateway.updateFirmware({
      stationId,
      location,
      retrieveDate: retrieveDate ?? new Date().toISOString(),
      retries: retries ?? 3,
      requestedBy: 'internal-api',
    });

    res.status(202).json({
      success: true,
      data: {
        stationId,
        location,
        status: 'sent',
        result,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { stationFirmwareRouter };
export default router;
