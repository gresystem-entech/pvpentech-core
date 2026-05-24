/**
 * Phase 3-D: Core→Portal cross-schema 접근 제거.
 * - prismaLegacy.chargingSite (Portal 모델) 조회 제거.
 * - partnerId 필터: chargingSite 조회 불가 → stationId 필터로 대체.
 *   TODO(Phase 4): partnerId 필터를 위해 Core Internal API에 /fault-logs?partnerId=X 추가.
 *   현재: partnerId 파라미터 수신 시 stationId 없이 전체 조회 (필터 무시 + warn 로그).
 */
import { Router } from 'express';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { asyncHandler } from '@pvpentech/shared/utils/asyncHandler';
import { logger } from '@pvpentech/shared/config/logger';

const router = Router();

/**
 * @swagger
 * /api/portal/cs/fault-logs:
 *   get:
 *     tags: [CS - Fault Logs]
 *     summary: 장애 로그 목록 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - name: limit
 *         in: query
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - name: keyword
 *         in: query
 *         required: false
 *         schema: { type: string }
 *       - name: status
 *         in: query
 *         required: false
 *         schema: { type: string }
 *       - name: startDate
 *         in: query
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - name: endDate
 *         in: query
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - name: stationId
 *         in: query
 *         required: false
 *         schema: { type: string }
 *       - name: siteId
 *         in: query
 *         required: false
 *         schema: { type: integer }
 *       - name: partnerId
 *         in: query
 *         required: false
 *         schema: { type: integer }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
// 전체 장애로그 목록 (필터: stationId, siteId, partnerId, startDate, endDate, status)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    const orConditions: Record<string, unknown>[] = [];

    if (req.query.keyword) {
      const kw = req.query.keyword as string;
      const allFaultTypes = ['ConnectorFault', 'CommunicationError', 'PowerFault', 'Other'];
      const matchingTypes = allFaultTypes.filter((ft) => ft.toLowerCase().includes(kw.toLowerCase()));
      orConditions.push({ description: { contains: kw, mode: 'insensitive' } });
      if (matchingTypes.length > 0) {
        orConditions.push({ faultType: { in: matchingTypes } });
      }
      where['OR'] = orConditions;
    }

    if (req.query.status) where['status'] = req.query.status;
    if (req.query.startDate || req.query.endDate) {
      where['reportedAt'] = {
        ...(req.query.startDate && { gte: new Date(req.query.startDate as string) }),
        ...(req.query.endDate && { lte: new Date(req.query.endDate as string) }),
      };
    }

    // Phase 3-D: Core→Portal cross-schema 접근 제거.
    // partnerId 필터: chargingSite(Portal 모델) 직접 조회 불가.
    // TODO(Phase 4): Core Internal API에 /fault-logs?partnerId=X 추가 후 전환.
    if (req.query.partnerId) {
      logger.warn(
        { partnerId: req.query.partnerId },
        '[faultLogs] partnerId 필터는 Phase 4에서 지원 예정 — 현재 전체 반환'
      );
      // partnerId 필터 무시 — 전체 목록 반환 (TODO Phase 4)
    } else if (req.query.siteId) {
      const stationIds = (
        await prisma.chargingStation.findMany({
          where: { siteId: Number(req.query.siteId) },
          select: { id: true },
        })
      ).map(s => s.id);
      where['stationId'] = { in: stationIds };
    } else if (req.query.stationId) {
      where['stationId'] = req.query.stationId;
    }

    const [items, total] = await Promise.all([
      prisma.faultLog.findMany({
        where,
        // TODO(Phase 3-D): site relation 제거됨 (Phase 3-B). siteId Logical FK만 반환.
        // station.siteId 값으로 Portal에서 ChargingSite + PartnerProfile 별도 조회 필요.
        include: {
          station: true,
        },
        skip,
        take: limit,
        orderBy: { reportedAt: 'desc' },
      }),
      prisma.faultLog.count({ where }),
    ]);

    res.json({ success: true, data: { items, total, page, limit, totalPages: Math.ceil(total / limit) } });
  })
);

/**
 * @swagger
 * /api/portal/cs/fault-logs:
 *   post:
 *     tags: [CS - Fault Logs]
 *     summary: 장애 로그 등록
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stationId]
 *             properties:
 *               stationId: { type: string }
 *               faultType:
 *                 type: string
 *                 enum: [ConnectorFault, CommunicationError, PowerFault, Other]
 *               description: { type: string }
 *               reportedBy: { type: string }
 *     responses:
 *       201:
 *         description: 등록 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
// 장애 등록
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { stationId, faultType, description, reportedBy } = req.body;
    if (!stationId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'stationId 필수' } });
      return;
    }
    const fault = await prisma.faultLog.create({
      data: {
        stationId,
        faultType: faultType || 'ConnectorFault',
        description,
        reportedBy: reportedBy || (req as unknown as { user?: { username: string } }).user?.username || 'unknown',
        status: 'Received',
      },
    });
    res.status(201).json({ success: true, data: fault });
  })
);

/**
 * @swagger
 * /api/portal/cs/fault-logs/{id}/status:
 *   patch:
 *     tags: [CS - Fault Logs]
 *     summary: 장애 상태 변경 (접수/조치중/완료)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [Received, InProgress, Resolved]
 *     responses:
 *       200:
 *         description: 상태 변경 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
// 장애 상태 변경 (접수/조치중/완료)
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'status 필수' } });
      return;
    }
    const data: Record<string, unknown> = { status };
    if (status === 'Resolved') data['resolvedAt'] = new Date();
    const fault = await prisma.faultLog.update({ where: { id: Number(req.params.id) }, data });
    res.json({ success: true, data: fault });
  })
);

export default router;
