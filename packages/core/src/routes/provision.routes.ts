import { Router } from 'express';
import { ProvisionController } from '@core/controllers/provision.controller';
import { provisionService } from '@core/services/provision.service';
import { provisionRateLimiter } from '@pvpentech/shared/middlewares/rateLimiter.middleware';

const router = Router();
const controller = new ProvisionController(provisionService);

// Public endpoint — no auth required, rate limited
/**
 * @swagger
 * /provision:
 *   post:
 *     tags: [Mobile Provision]
 *     summary: 충전기 시리얼 번호 기반 프로비저닝 (공개, Rate Limited)
 *     security: []
 *     parameters:
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [serial_number]
 *             properties:
 *               serial_number: { type: string, example: "EN901954" }
 *     responses:
 *       200:
 *         description: 프로비저닝 성공 (충전기 인증 정보 발급)
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: 충돌 (이미 프로비저닝된 시리얼 번호 등)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Rate limit 초과
 */
router.post('/', provisionRateLimiter, controller.provision);

export default router;
