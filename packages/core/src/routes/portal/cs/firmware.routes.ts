import { Router } from 'express';
import multer from 'multer';
import { firmwareController } from '@core/controllers/firmware.controller';
import { env } from '@pvpentech/shared/config/env';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.FIRMWARE_MAX_SIZE_MB * 1024 * 1024 },
});

/**
 * @swagger
 * tags:
 *   name: CS - Firmware
 *   description: 펌웨어 관리 (업로드 / 캠페인 / 진행 추적)
 */

/**
 * @swagger
 * /api/portal/cs/firmware:
 *   post:
 *     tags: [CS - Firmware]
 *     summary: 펌웨어 업로드 (multipart/form-data)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, version]
 *             properties:
 *               file: { type: string, format: binary }
 *               version: { type: string, maxLength: 50 }
 *               chargerModel: { type: string, maxLength: 100 }
 *               chargerVendor: { type: string, maxLength: 100 }
 *               notes: { type: string, maxLength: 1000 }
 *     responses:
 *       201: { description: 업로드 성공 }
 *       409: { description: 동일 SHA256 바이너리 이미 존재 }
 */
router.post('/', upload.single('file'), firmwareController.upload);

/**
 * @swagger
 * /api/portal/cs/firmware:
 *   get:
 *     tags: [CS - Firmware]
 *     summary: 펌웨어 목록
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 */
router.get('/', firmwareController.list);

/**
 * @swagger
 * /api/portal/cs/firmware/campaigns:
 *   get:
 *     tags: [CS - Firmware]
 *     summary: 캠페인 목록
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [running, completed, cancelled] }
 *       - in: query
 *         name: firmwareId
 *         schema: { type: integer }
 */
router.get('/campaigns', firmwareController.listCampaigns);

/**
 * @swagger
 * /api/portal/cs/firmware/campaigns/{id}:
 *   get:
 *     tags: [CS - Firmware]
 *     summary: 캠페인 상세 (progress 포함)
 *     security: [{ bearerAuth: [] }]
 */
router.get('/campaigns/:id', firmwareController.campaignDetail);

/**
 * @swagger
 * /api/portal/cs/firmware/campaigns/{id}/cancel:
 *   post:
 *     tags: [CS - Firmware]
 *     summary: 캠페인 취소
 *     security: [{ bearerAuth: [] }]
 */
router.post('/campaigns/:id/cancel', firmwareController.cancelCampaign);

/**
 * @swagger
 * /api/portal/cs/firmware/{id}:
 *   get:
 *     tags: [CS - Firmware]
 *     summary: 펌웨어 상세
 *     security: [{ bearerAuth: [] }]
 */
router.get('/:id', firmwareController.findById);

/**
 * @swagger
 * /api/portal/cs/firmware/{id}:
 *   patch:
 *     tags: [CS - Firmware]
 *     summary: 펌웨어 메타 수정 (version, isActive 등)
 *     security: [{ bearerAuth: [] }]
 */
router.patch('/:id', firmwareController.update);

/**
 * @swagger
 * /api/portal/cs/firmware/{id}:
 *   delete:
 *     tags: [CS - Firmware]
 *     summary: 펌웨어 삭제 (캠페인 사용 이력 있으면 거부)
 *     security: [{ bearerAuth: [] }]
 */
router.delete('/:id', firmwareController.delete);

/**
 * @swagger
 * /api/portal/cs/firmware/{id}/campaigns:
 *   post:
 *     tags: [CS - Firmware]
 *     summary: 펌웨어 일괄 업데이트 캠페인 시작
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetFilter]
 *             properties:
 *               targetFilter:
 *                 type: object
 *                 properties:
 *                   stationIds: { type: array, items: { type: string }, description: "명시 목록 (지정 시 다른 필터 무시)" }
 *                   model: { type: string }
 *                   vendor: { type: string }
 *                   siteId: { type: integer }
 *               notes: { type: string, maxLength: 1000 }
 */
router.post('/:id/campaigns', firmwareController.startCampaign);

export default router;
