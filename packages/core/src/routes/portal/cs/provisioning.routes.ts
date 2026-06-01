import { Router } from 'express';
import { ProvisionController } from '@core/controllers/provision.controller';
import { provisionService } from '@core/services/provision.service';
import { asyncHandler } from '@pvpentech/shared/utils/asyncHandler';
import multer from 'multer';
import { parse } from 'csv-parse';
import { Readable } from 'stream';

const router = Router();
const controller = new ProvisionController(provisionService);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * @swagger
 * /api/portal/cs/provisioning/sample-csv:
 *   get:
 *     tags: [CS - Provisioning]
 *     summary: 일괄등록용 예제 CSV 다운로드
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     responses:
 *       200:
 *         description: CSV 파일
 *         content:
 *           text/csv:
 *             schema: { type: string, format: binary }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
// 예제 CSV 다운로드 (before /:id to avoid route conflict)
router.get('/sample-csv', (_req, res) => {
  // v2.1: chargingKwh 컬럼 추가
  const csv =
    'serialNumber,manufacturerChannelId,chargingKwh\n' +
    'SN-VENDOR-2026-001,vendor_a,3.5\n' +
    'SN-VENDOR-2026-002,vendor_a,11\n' +
    'SN-VENDOR-2026-003,vendor_b,22\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="provisioning_sample.csv"');
  res.send(csv);
});

/**
 * @swagger
 * /api/portal/cs/provisioning/bulk-upload:
 *   post:
 *     tags: [CS - Provisioning]
 *     summary: CSV 파일을 통한 충전기 일괄 등록
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: "serialNumber 컬럼을 포함한 CSV 파일. 선택 컬럼: manufacturerChannelId, chargingKwh(시간당 충전용량 kWh/h, 기본값 3.5)"
 *     responses:
 *       200:
 *         description: 일괄 등록 결과
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
// CSV 일괄등록
router.post(
  '/bulk-upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'CSV 파일이 필요합니다.' } });
      return;
    }

    const records: Record<string, string>[] = await new Promise((resolve, reject) => {
      const results: Record<string, string>[] = [];
      const stream = Readable.from(req.file!.buffer);
      stream
        .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
        .on('data', (row: Record<string, string>) => results.push(row))
        .on('end', () => resolve(results))
        .on('error', reject);
    });

    // v2.1: chargingKwh 컬럼 지원 (빈 문자열은 undefined → service/DB default 3.5 적용)
    const rows = records
      .map((r) => {
        const kwhRaw = (r.chargingKwh ?? '').toString().trim();
        const kwh = kwhRaw === '' ? undefined : Number(kwhRaw);
        return {
          serialNumber: r.serialNumber || '',
          manufacturerChannelId: r.manufacturerChannelId || undefined,
          chargingKwh: kwh,
        };
      })
      .filter((r) => r.serialNumber);

    const result = await provisionService.bulkRegister(rows, req.user?.username || 'unknown');
    res.json({ success: true, data: result });
  })
);

/**
 * @swagger
 * /api/portal/cs/provisioning:
 *   get:
 *     tags: [CS - Provisioning]
 *     summary: 프로비저닝 레코드 목록 조회
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - name: limit
 *         in: query
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - name: status
 *         in: query
 *         required: false
 *         schema: { type: string }
 *       - name: keyword
 *         in: query
 *         required: false
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
 */
router.get('/', controller.list);
/**
 * @swagger
 * /api/portal/cs/provisioning:
 *   post:
 *     tags: [CS - Provisioning]
 *     summary: 신규 충전기 프로비저닝 등록
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
 *             required: [serialNumber]
 *             properties:
 *               serialNumber: { type: string, maxLength: 100 }
 *               modelName: { type: string, maxLength: 100 }
 *               clientId: { type: string, maxLength: 50 }
 *               siteId: { type: integer }
 *               manufacturerId: { type: integer }
 *               chargingKwh: { type: number, format: float, example: 3.5, description: "시간당 충전용량 (kWh/h). 생략 시 기본값 3.5 적용" }
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
router.post('/', controller.register);
/**
 * @swagger
 * /api/portal/cs/provisioning/{id}:
 *   get:
 *     tags: [CS - Provisioning]
 *     summary: 프로비저닝 레코드 상세 조회
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
 * /api/portal/cs/provisioning/{id}:
 *   put:
 *     tags: [CS - Provisioning]
 *     summary: 프로비저닝 레코드 수정
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
 *               serialNumber: { type: string }
 *               rejectReason: { type: string }
 *               chargingKwh: { type: number, format: float, example: 3.5, description: "시간당 충전용량 (kWh/h)" }
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
router.put('/:id', controller.update);
/**
 * @swagger
 * /api/portal/cs/provisioning/{id}:
 *   delete:
 *     tags: [CS - Provisioning]
 *     summary: 프로비저닝 레코드 삭제
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
router.delete('/:id', controller.delete);
/**
 * @swagger
 * /api/portal/cs/provisioning/{id}/revoke:
 *   patch:
 *     tags: [CS - Provisioning]
 *     summary: 프로비저닝 레코드 회수(revoke)
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
 *         description: 회수 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/:id/revoke', controller.revoke);

export default router;
