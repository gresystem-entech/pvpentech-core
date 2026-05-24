/**
 * Internal API — 충전기 상태 조회 라우트 (Phase 2-B, B4)
 *
 * GET 전용. 기존 service를 직접 호출 (단일 프로세스 내).
 *
 * | 메서드 | 경로 | 설명 |
 * |--------|------|------|
 * | GET | /stations | 목록 (페이지네이션, status/keyword 필터) |
 * | GET | /stations/:stationId | 상세 (커넥터 포함) |
 * | GET | /stations/:stationId/connection | 연결 상태 |
 * | GET | /stations/:stationId/connectors | 커넥터 목록 |
 * | GET | /stations/:stationId/ocpp-messages | OCPP 메시지 로그 |
 * | GET | /stations/:stationId/command-results | OCPP 명령 결과 이력 |
 */

import { Router, Request, Response, NextFunction } from 'express';
import { stationService } from '@core/services/station.service';
import { ocppMessageService } from '@core/services/ocppMessage.service';
import { ocppCommandResultService } from '@core/services/ocppCommandResult.service';
import { connectionManager } from '@core/ocpp/connectionManager';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';
import { parsePagination } from '@pvpentech/shared/utils/auth';

const router = Router();

// ─── GET /stations — 목록 ────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const keyword = req.query.keyword ? String(req.query.keyword) : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const result = await stationService.list({ status, keyword, page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ─── GET /stations/:stationId — 상세 ────────────────────────────────────────

router.get('/:stationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    const station = await stationService.findById(stationId);
    res.json({ success: true, data: station });
  } catch (err) {
    // NotFoundError → InternalApiError STATION_NOT_FOUND 으로 변환
    if (err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
      next(InternalApiErrors.stationNotFound(req.params.stationId));
    } else {
      next(err);
    }
  }
});

// ─── GET /stations/:stationId/connection — 연결 상태 ────────────────────────

router.get('/:stationId/connection', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;

    // 충전기 존재 여부 확인
    const station = await prisma.chargingStation.findUnique({
      where: { id: stationId },
      select: { id: true, lastHeartbeatAt: true },
    });

    if (!station) {
      throw InternalApiErrors.stationNotFound(stationId);
    }

    const isConnected = connectionManager.isConnected(stationId);

    res.json({
      success: true,
      data: {
        stationId,
        isConnected,
        lastHeartbeatAt: station.lastHeartbeatAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /stations/:stationId/connectors — 커넥터 목록 ──────────────────────

router.get('/:stationId/connectors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;

    const stationExists = await prisma.chargingStation.findUnique({
      where: { id: stationId },
      select: { id: true },
    });

    if (!stationExists) {
      throw InternalApiErrors.stationNotFound(stationId);
    }

    const connectors = await prisma.connector.findMany({
      where: { stationId },
      orderBy: { connectorId: 'asc' },
    });

    res.json({ success: true, data: connectors });
  } catch (err) {
    next(err);
  }
});

// ─── GET /stations/:stationId/ocpp-messages — OCPP 메시지 로그 ──────────────

router.get('/:stationId/ocpp-messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    const action = req.query.action ? String(req.query.action) : undefined;
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const stationExists = await prisma.chargingStation.findUnique({
      where: { id: stationId },
      select: { id: true },
    });

    if (!stationExists) {
      throw InternalApiErrors.stationNotFound(stationId);
    }

    const result = await ocppMessageService.list({ stationId, action, startDate, endDate, page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ─── GET /stations/:stationId/command-results — OCPP 명령 결과 이력 ──────────

router.get('/:stationId/command-results', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationId } = req.params;
    const action = req.query.action ? String(req.query.action) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const sentFrom = req.query.sentFrom ? new Date(String(req.query.sentFrom)) : undefined;
    const sentTo = req.query.sentTo ? new Date(String(req.query.sentTo)) : undefined;

    const stationExists = await prisma.chargingStation.findUnique({
      where: { id: stationId },
      select: { id: true },
    });

    if (!stationExists) {
      throw InternalApiErrors.stationNotFound(stationId);
    }

    // parsePagination을 직접 사용하여 기본값 정규화
    const { page: pg, limit: lim } = parsePagination(page, limit);

    const result = await ocppCommandResultService.list({
      stationId,
      action,
      status,
      page: pg,
      limit: lim,
      sentFrom,
      sentTo,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
