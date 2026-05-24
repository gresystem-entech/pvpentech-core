import { Router } from 'express';
import { asyncHandler } from '@pvpentech/shared/utils/asyncHandler';
import { chargerConfigService } from '@core/services/chargerConfig.service';
import { ChargerConfigStatus } from '@prisma/client';

const router = Router();

/**
 * @swagger
 * /api/portal/cs/provisioning/configs:
 *   get:
 *     tags: [CS - Charger Configs]
 *     summary: 충전기 설정 항목 목록 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: stationId
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
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await chargerConfigService.list({
      stationId: req.query.stationId as string,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
    });
    res.json({ success: true, data: result });
  })
);

/**
 * @swagger
 * /api/portal/cs/provisioning/configs:
 *   post:
 *     tags: [CS - Charger Configs]
 *     summary: 충전기 설정 항목 생성
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
 *             required: [stationId, key]
 *             properties:
 *               stationId: { type: string }
 *               key: { type: string }
 *               value: { type: string }
 *               status: { type: string, description: ChargerConfigStatus }
 *               errorDesc: { type: string }
 *     responses:
 *       201:
 *         description: 생성 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { stationId, key, value, status, errorDesc } = req.body;
    if (!stationId || !key) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'stationId와 key는 필수입니다.' } });
      return;
    }
    const item = await chargerConfigService.create({ stationId, key, value, status: status as ChargerConfigStatus, errorDesc });
    res.status(201).json({ success: true, data: item });
  })
);

/**
 * @swagger
 * /api/portal/cs/provisioning/configs/{id}:
 *   put:
 *     tags: [CS - Charger Configs]
 *     summary: 충전기 설정 항목 수정
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
 *             properties:
 *               value: { type: string }
 *               status: { type: string, description: ChargerConfigStatus }
 *               errorDesc: { type: string }
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
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { value, status, errorDesc } = req.body;
    const item = await chargerConfigService.update(Number(req.params.id), { value, status: status as ChargerConfigStatus, errorDesc });
    res.json({ success: true, data: item });
  })
);

/**
 * @swagger
 * /api/portal/cs/provisioning/configs/{id}:
 *   delete:
 *     tags: [CS - Charger Configs]
 *     summary: 충전기 설정 항목 삭제
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     responses:
 *       200:
 *         description: 삭제 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await chargerConfigService.delete(Number(req.params.id));
    res.json({ success: true, data: { message: '설정 항목이 삭제되었습니다.' } });
  })
);

export default router;
