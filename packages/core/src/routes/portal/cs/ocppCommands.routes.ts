import { Router } from 'express';
import { ocppCommandController } from '@core/controllers/ocppCommand.controller';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: CS - OCPP Commands
 *   description: CSMS→CP 명령 송수신 결과 조회 (Phase 4-C)
 */

/**
 * @swagger
 * /api/portal/cs/ocpp-commands:
 *   get:
 *     tags: [CS - OCPP Commands]
 *     summary: OCPP 명령 결과 목록 조회
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: stationId
 *         schema: { type: string }
 *       - in: query
 *         name: action
 *         schema: { type: string, example: GetConfiguration }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, completed, error, timeout] }
 *       - in: query
 *         name: requestedBy
 *         schema: { type: string }
 *       - in: query
 *         name: sentFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: sentTo
 *         schema: { type: string, format: date-time }
 */
router.get('/', ocppCommandController.list);

/**
 * @swagger
 * /api/portal/cs/ocpp-commands/stats:
 *   get:
 *     tags: [CS - OCPP Commands]
 *     summary: 최근 N일 status 별 카운트
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 7, minimum: 1, maximum: 90 }
 */
router.get('/stats', ocppCommandController.stats);

/**
 * @swagger
 * /api/portal/cs/ocpp-commands/{id}:
 *   get:
 *     tags: [CS - OCPP Commands]
 *     summary: 명령 결과 상세 (requestPayload + responsePayload + errorCode 등 raw)
 *     security: [{ bearerAuth: [] }]
 */
router.get('/:id', ocppCommandController.findById);

export default router;
