/**
 * Internal API — 진단 및 설정 라우트 (Phase 2-B, B8)
 *
 * 이 라우터는 /stations 아래에 마운트되므로 /:stationId/* 형태.
 * mergeParams: true 로 상위 라우터의 :stationId를 상속.
 *
 * | 메서드 | 경로 |
 * |--------|------|
 * | POST | /stations/:stationId/diagnostics |
 * | GET | /stations/:stationId/diagnostics |
 * | GET | /stations/:stationId/config |
 * | PUT | /stations/:stationId/config/:key |
 */

import { Router, Request, Response, NextFunction } from 'express';
import { connectionManager } from '@core/ocpp/connectionManager';
import { sendGetDiagnostics } from '@core/ocpp/commands/getDiagnostics.command';
import { chargerConfigService } from '@core/services/chargerConfig.service';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';

const router = Router({ mergeParams: true });

// ─── 공통 헬퍼 ──────────────────────────────────────────────────────────────

async function assertStationExists(stationId: string): Promise<void> {
  const station = await prisma.chargingStation.findUnique({
    where: { id: stationId },
    select: { id: true },
  });
  if (!station) {
    throw InternalApiErrors.stationNotFound(stationId);
  }
}

async function assertStationOnline(stationId: string): Promise<void> {
  await assertStationExists(stationId);
  if (!connectionManager.isConnected(stationId)) {
    throw InternalApiErrors.stationOffline(stationId);
  }
}

// ─── POST /:stationId/diagnostics — 진단 요청 ────────────────────────────────

router.post('/:stationId/diagnostics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationOnline(stationId);

    const { location, startTime, stopTime, retries, retryInterval } = req.body as {
      location?: string;
      startTime?: string;
      stopTime?: string;
      retries?: number;
      retryInterval?: number;
    };

    if (!location) {
      throw InternalApiErrors.badRequest('location (upload URL) is required');
    }

    const result = await sendGetDiagnostics(
      stationId,
      { location, startTime, stopTime, retries, retryInterval },
      'internal-api',
    );

    res.status(202).json({
      success: true,
      data: {
        stationId,
        status: 'sent',
        fileName: result.fileName,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /:stationId/diagnostics — 진단 요청 이력 ────────────────────────────

router.get('/:stationId/diagnostics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationExists(stationId);

    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.diagnosticsRequest.findMany({
        where: { stationId },
        orderBy: { requestedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.diagnosticsRequest.count({ where: { stationId } }),
    ]);

    res.json({
      success: true,
      data: { items, total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /:stationId/config — 설정 목록 ──────────────────────────────────────

router.get('/:stationId/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    await assertStationExists(stationId);

    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const result = await chargerConfigService.list({ stationId, page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /:stationId/config/:key — 설정 값 변경 ──────────────────────────────

router.put('/:stationId/config/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId, key } = req.params;
    await assertStationExists(stationId);

    const { value, status, errorDesc } = req.body as {
      value?: string;
      status?: string;
      errorDesc?: string;
    };

    if (value === undefined && status === undefined) {
      throw InternalApiErrors.badRequest('value or status is required');
    }

    // 기존 config 레코드 조회
    const existing = await prisma.chargerConfig.findUnique({
      where: { stationId_key: { stationId, key } },
    });

    let result;
    if (existing) {
      result = await chargerConfigService.update(existing.id, {
        value,
        status: status as Parameters<typeof chargerConfigService.update>[1]['status'],
        errorDesc,
      });
    } else {
      result = await chargerConfigService.create({
        stationId,
        key,
        value,
        status: status as Parameters<typeof chargerConfigService.create>[0]['status'],
        errorDesc,
      });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
