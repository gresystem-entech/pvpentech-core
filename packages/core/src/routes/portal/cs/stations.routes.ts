/**
 * Phase 3-D: Core→Portal cross-schema 접근 제거.
 * - prismaLegacy.chargingSite (Portal 모델) 직접 조회 제거.
 * - filterOptions 엔드포인트의 sites 항목: Core ChargingStation.siteId 목록은 조회하되
 *   siteName 조회(Portal schema)는 불가 → siteId만 반환.
 *   TODO(Phase 4): Portal 측 /api/internal/v1/sites 엔드포인트 추가 후 HTTP 조회로 전환.
 */
import { provisionService } from '@pvpentech/core/services/provision.service';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { StationController } from '@core/controllers/station.controller';
import { stationService } from '@core/services/station.service';
import { asyncHandler } from '@pvpentech/shared/utils/asyncHandler';
import { Router } from 'express';

const router = Router();
const controller = new StationController(stationService, provisionService);

/**
 * @swagger
 * /api/portal/cs/stations:
 *   get:
 *     tags: [CS - Stations]
 *     summary: 충전기 목록 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: status
 *         in: query
 *         required: false
 *         schema: { type: string }
 *         description: 상태 필터
 *       - name: keyword
 *         in: query
 *         required: false
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/PageQuery'
 *       - name: limit
 *         in: query
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
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
router.get('/', controller.list);

/**
 * @swagger
 * /api/portal/cs/stations:
 *   post:
 *     tags: [CS - Stations]
 *     summary: 충전기 신규 등록
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
 *             required: [id]
 *             properties:
 *               id:
 *                 type: string
 *                 pattern: '^EN\d{7}$'
 *                 description: 충전기 ID ("EN" + 7자리 숫자)
 *               siteId: { type: integer }
 *               manufacturer: { type: string }
 *               serialNumber: { type: string }
 *               firmwareVersion: { type: string }
 *     responses:
 *       201:
 *         description: 생성됨
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/', controller.create);

/**
 * @swagger
 * /api/portal/cs/stations/offline:
 *   get:
 *     tags: [CS - Stations]
 *     summary: 충전기 오프라인 이력 조회
 *     description: 기간 미지정 시 현재 오프라인 상태인 충전기, 기간 지정 시 해당 기간의 오프라인 이력을 반환한다.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: dateFrom
 *         in: query
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - name: dateTo
 *         in: query
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - $ref: '#/components/parameters/PageQuery'
 *       - name: limit
 *         in: query
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
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
// 오프라인 이력 목록 (must be before /:id to avoid conflict)
router.get('/offline', asyncHandler(async (req, res) => {
  const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : null;
  const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : null;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  let where: Record<string, unknown>;
  if (dateFrom || dateTo) {
    // 기간 지정: 해당 기간에 offline 상태였던 이력
    const loggedAtFilter: Record<string, unknown> = {};
    if (dateFrom) loggedAtFilter['gte'] = dateFrom;
    if (dateTo) loggedAtFilter['lte'] = dateTo;
    where = { loggedAt: loggedAtFilter };
  } else {
    // 기간 미지정: 현재 offline 상태인 충전기 (resolvedAt이 없는)
    where = { resolvedAt: null };
  }

  const [items, total] = await Promise.all([
    prisma.offlineLog.findMany({
      where,
      // TODO(Phase 3-D): site relation 제거됨 (Phase 3-B). siteId Logical FK만 반환.
      include: { station: true },
      skip,
      take: limit,
      orderBy: { loggedAt: 'desc' },
    }),
    prisma.offlineLog.count({ where }),
  ]);
  res.json({ success: true, data: { items, total, page, limit, totalPages: Math.ceil(total / limit) } });
}));

/**
 * @swagger
 * /api/portal/cs/stations/facets:
 *   get:
 *     tags: [CS - Stations]
 *     summary: 충전기 패싯 목록 조회 (캠페인 모달용)
 *     description: 캠페인 대상 선택 드롭다운에 사용할 distinct 모델명/제조사명/충전소 목록을 반환한다.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     modelNames:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: DB에 등록된 distinct 모델명 목록 (locale-aware 정렬)
 *                     vendors:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: vendorName ∪ manufacturer distinct 목록 (locale-aware 정렬)
 *                     sites:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             description: 충전소 ID
 *                           name:
 *                             type: string
 *                             description: 충전소명
 *                       description: 충전기가 매핑된 충전소 목록 (id 오름차순)
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
// 캠페인 모달용 패싯 목록 (must be before /:id to avoid conflict)
router.get('/facets', asyncHandler(async (_req, res) => {
  const [modelRows, vendorNameRows, manufacturerRows, siteIdRows] = await Promise.all([
    prisma.chargingStation.findMany({
      where: { modelName: { not: null } },
      select: { modelName: true },
      distinct: ['modelName'],
    }),
    prisma.chargingStation.findMany({
      where: { vendorName: { not: null } },
      select: { vendorName: true },
      distinct: ['vendorName'],
    }),
    prisma.chargingStation.findMany({
      where: { manufacturer: { not: null } },
      select: { manufacturer: true },
      distinct: ['manufacturer'],
    }),
    prisma.chargingStation.findMany({
      where: { siteId: { not: null } },
      select: { siteId: true },
      distinct: ['siteId'],
    }),
  ]);

  const modelNames = modelRows
    .map((r) => r.modelName as string)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const vendorSet = new Set<string>([
    ...vendorNameRows.map((r) => r.vendorName as string),
    ...manufacturerRows.map((r) => r.manufacturer as string),
  ]);
  const vendors = [...vendorSet].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );

  // Phase 3-D: chargingSite는 Portal schema — Core에서 직접 조회 불가.
  // siteId 목록만 반환. siteName은 Portal에서 별도 조회 필요.
  // TODO(Phase 4): Portal Internal API /sites?ids=... 추가 후 siteName 채우기.
  const siteIds = siteIdRows
    .map((r) => r.siteId as number)
    .filter((id): id is number => id !== null && id !== undefined)
    .sort((a, b) => a - b);
  const sites = siteIds.map((id) => ({ id, name: null }));

  res.json({ success: true, data: { modelNames, vendors, sites } });
}));

/**
 * @swagger
 * /api/portal/cs/stations/{id}:
 *   get:
 *     tags: [CS - Stations]
 *     summary: 충전기 상세 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: 충전기 ID (예 EN0000001)
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', controller.findById);

/**
 * @swagger
 * /api/portal/cs/stations/{id}:
 *   put:
 *     tags: [CS - Stations]
 *     summary: 충전기 정보 수정
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               siteId: { type: integer }
 *               manufacturer: { type: string }
 *               serialNumber: { type: string }
 *               firmwareVersion: { type: string }
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put('/:id', controller.update);

/**
 * @swagger
 * /api/portal/cs/stations/{id}:
 *   delete:
 *     tags: [CS - Stations]
 *     summary: 충전기 비활성화(삭제)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id', controller.delete);

/**
 * @swagger
 * /api/portal/cs/stations/{id}/faults:
 *   get:
 *     tags: [CS - Stations]
 *     summary: 충전기 장애 로그 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/PageQuery'
 *       - name: limit
 *         in: query
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id/faults', controller.getFaultLogs);

/**
 * @swagger
 * /api/portal/cs/stations/{id}/faults:
 *   post:
 *     tags: [CS - Stations]
 *     summary: 충전기 장애 로그 등록
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [faultType]
 *             properties:
 *               faultType:
 *                 type: string
 *                 enum: [ConnectorFault, CommunicationError, PowerFault, Other]
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: 생성됨
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/faults', controller.addFaultLog);

/**
 * @swagger
 * /api/portal/cs/stations/{id}/reset-password:
 *   post:
 *     tags: [CS - Stations]
 *     summary: 충전기 OCPP Basic Auth 비밀번호 재발급
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/reset-password', controller.resetPassword);

/**
 * @swagger
 * /api/portal/cs/stations/{id}/transactions:
 *   get:
 *     tags: [CS - Stations]
 *     summary: 충전기별 충전 이력 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/PageQuery'
 *       - name: limit
 *         in: query
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
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
// 충전기별 충전이력
router.get('/:id/transactions', asyncHandler(async (req, res) => {
  const stationId = req.params.id;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({ where: { stationId }, skip, take: limit, orderBy: { timeStart: 'desc' } }),
    prisma.transaction.count({ where: { stationId } }),
  ]);
  res.json({ success: true, data: { items, total, page, limit, totalPages: Math.ceil(total / limit) } });
}));

export default router;
