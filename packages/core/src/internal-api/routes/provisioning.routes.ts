/**
 * Internal API — 프로비저닝 + 제조사 관리 라우트 (Phase 2-B, B9)
 *
 * | 메서드 | 경로 |
 * |--------|------|
 * | GET | /provisioning |
 * | POST | /provisioning |
 * | PUT | /provisioning/:id/reject |
 * | GET | /manufacturers |
 * | POST | /manufacturers |
 */

import { Router, Request, Response, NextFunction } from 'express';
import { provisionService } from '@core/services/provision.service';
import { manufacturerService } from '@core/services/manufacturer.service';
import { InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';

// ─── 프로비저닝 라우터 ─────────────────────────────────────────────────────────

export const provisioningRouter = Router();

// GET /provisioning — 목록
provisioningRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const keyword = req.query.keyword ? String(req.query.keyword) : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const result = await provisionService.list({ status, keyword, page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /provisioning — 단일 등록
provisioningRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { serialNumber, modelName, clientId, siteId, manufacturerId } = req.body as {
      serialNumber?: string;
      modelName?: string;
      clientId?: string;
      siteId?: number;
      manufacturerId?: number;
    };

    if (!serialNumber) {
      throw InternalApiErrors.badRequest('serialNumber is required');
    }

    const result = await provisionService.register(
      serialNumber,
      'internal-api',
      modelName,
      clientId,
      siteId,
      manufacturerId,
    );

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// PUT /provisioning/:id/reject — 거부 처리 (revoke와 유사)
provisioningRouter.put('/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      throw InternalApiErrors.badRequest('id must be a number');
    }

    const { rejectReason } = req.body as { rejectReason?: string };

    // 거부: status → 'rejected' + rejectReason 업데이트
    const result = await provisionService.update(id, { rejectReason });

    // status도 rejected로 변경 — DB 직접 업데이트
    const { prisma } = await import('@pvpentech/shared/config/database');
    const updated = await prisma.chargerProvisioning.update({
      where: { id },
      data: { status: 'rejected', rejectReason: rejectReason ?? null },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── 제조사 라우터 ────────────────────────────────────────────────────────────

export const manufacturersRouter = Router();

// GET /manufacturers — 목록
manufacturersRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const result = await manufacturerService.findAll({ page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /manufacturers — 등록
manufacturersRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { channelId, name, plainToken } = req.body as {
      channelId?: string;
      name?: string;
      plainToken?: string;
    };

    if (!channelId) {
      throw InternalApiErrors.badRequest('channelId is required');
    }
    if (!name) {
      throw InternalApiErrors.badRequest('name is required');
    }

    const result = await manufacturerService.create({ channelId, name, plainToken });

    // plainToken은 1회만 반환 — 보안상 응답에 포함
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
