import { Router } from 'express';
import { ManufacturerController } from '@core/controllers/manufacturer.controller';
import { manufacturerService } from '@core/services/manufacturer.service';

const router = Router();
const controller = new ManufacturerController(manufacturerService);

/**
 * @swagger
 * /api/portal/cs/manufacturers:
 *   get:
 *     tags: [CS - Manufacturers]
 *     summary: 제조사 목록 조회 (페이지네이션)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageQuery'
 *       - name: limit
 *         in: query
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     responses:
 *       200:
 *         description: 제조사 목록
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', controller.list);

/**
 * @swagger
 * /api/portal/cs/manufacturers:
 *   post:
 *     tags: [CS - Manufacturers]
 *     summary: 제조사 등록 (x-token 1회 발급)
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
 *             required: [channelId, name]
 *             properties:
 *               channelId:
 *                 type: string
 *                 maxLength: 50
 *                 description: "x-channel 헤더 값. 영문/숫자/언더스코어/하이픈 허용 (예: vendor_a, GRE)"
 *                 example: GRE
 *               name:
 *                 type: string
 *                 maxLength: 100
 *                 description: 제조사 법인명 또는 브랜드명
 *                 example: "VendorA Co., Ltd."
 *               plainToken:
 *                 type: string
 *                 minLength: 16
 *                 maxLength: 128
 *                 description: |
 *                   (옵션) 제조사 펌웨어에 이미 박혀 있는 기존 x-token 을 그대로 임포트할 때만 지정.
 *                   미지정 시 서버가 64자 hex 랜덤 토큰을 신규 발급한다.
 *                   영문/숫자/언더스코어/하이픈만 허용.
 *                 example: "4af9914893d343698cde96f7b576ebad"
 *     responses:
 *       201:
 *         description: 등록 성공 — plainToken 1회 포함
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: integer, example: 1 }
 *                     channelId: { type: string, example: vendor_a }
 *                     name: { type: string, example: "VendorA Co., Ltd." }
 *                     isActive: { type: boolean, example: true }
 *                     createdAt: { type: string, format: date-time }
 *                     plainToken: { type: string, description: "1회만 표시되는 평문 토큰 (자동 발급 시 64자 hex; 임포트 시 입력값과 동일)" }
 *                     imported: { type: boolean, description: "true면 CS가 입력한 plainToken으로 임포트된 등록" }
 *                 notice: { type: string }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post('/', controller.create);

/**
 * @swagger
 * /api/portal/cs/manufacturers/{id}:
 *   get:
 *     tags: [CS - Manufacturers]
 *     summary: 제조사 상세 조회 (tokenHash 미포함)
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
 *         description: 제조사 상세
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
 * /api/portal/cs/manufacturers/{id}:
 *   put:
 *     tags: [CS - Manufacturers]
 *     summary: 제조사 정보 수정 (name, isActive)
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
 *               name: { type: string, maxLength: 100 }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: 수정 성공
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
 * /api/portal/cs/manufacturers/{id}/regenerate-token:
 *   post:
 *     tags: [CS - Manufacturers]
 *     summary: 제조사 토큰 재발급 (기존 토큰 즉시 무효화, 새 토큰 1회 표시)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               plainToken:
 *                 type: string
 *                 minLength: 16
 *                 maxLength: 128
 *                 description: |
 *                   (옵션) 신규 펌웨어 출시 등으로 특정 토큰 값으로 갱신해야 할 때 지정.
 *                   미지정 시 서버가 새 랜덤 토큰을 발급.
 *                 example: "4af9914893d343698cde96f7b576ebad"
 *     responses:
 *       200:
 *         description: 재발급 성공 — 새 plainToken 1회 포함
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     plainToken: { type: string, description: "새 평문 토큰 (자동 발급 시 64자 hex; 임포트 시 입력값과 동일)" }
 *                     imported: { type: boolean }
 *                 notice: { type: string }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/regenerate-token', controller.regenerateToken);

/**
 * @swagger
 * /api/portal/cs/manufacturers/{id}:
 *   delete:
 *     tags: [CS - Manufacturers]
 *     summary: 제조사 비활성화 (소프트 삭제 — isActive=false)
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
 *         description: 비활성화 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id', controller.deactivate);

export default router;
