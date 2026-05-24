import { authMiddleware } from '@pvpentech/portal/middlewares/auth.middleware';
import { requireRole } from '@pvpentech/portal/middlewares/role.middleware';
import { NextFunction, Request, Response, Router } from 'express';

// Mobile API routes (portal)
import authRoutes from '@pvpentech/portal/routes/auth.routes';
import chargeRoutes from '@pvpentech/portal/routes/charge.routes';
import paymentRoutes from '@pvpentech/portal/routes/payment.routes';

// Charger provisioning route (core)
import provisionRoutes from '@pvpentech/core/routes/provision.routes';

// Core controllers + middleware
import { ProvisionController } from '@pvpentech/core/controllers/provision.controller';
import { manufacturerAuth } from '@pvpentech/portal/middlewares/manufacturerAuth.middleware';
import { provisionRateLimiter, loginRateLimiter } from '@pvpentech/portal/middlewares/rateLimiter.middleware';
import { provisionService } from '@pvpentech/core/services/provision.service';

// Portal auth controller
import { AuthController } from '@pvpentech/portal/controllers/auth.controller';
import { authService } from '@pvpentech/portal/services/auth.service';

// CS portal routes — Portal domain
import csChargerConfigsRoutes from '@pvpentech/core/routes/portal/cs/chargerConfigs.routes';
import csDashboardRoutes from '@pvpentech/portal/routes/portal/cs/dashboard.routes';
import csFaultLogsRoutes from '@pvpentech/core/routes/portal/cs/faultLogs.routes';
import csIdTokensRoutes from '@pvpentech/portal/routes/portal/cs/idTokens.routes';
import csFirmwareRoutes from '@pvpentech/core/routes/portal/cs/firmware.routes';
import csManufacturerRoutes from '@pvpentech/core/routes/portal/cs/manufacturer.routes';
import csOcppCommandsRoutes from '@pvpentech/core/routes/portal/cs/ocppCommands.routes';
import csOpsRoutes from '@pvpentech/portal/routes/portal/cs/ops.routes';
import csPartnersRoutes from '@pvpentech/portal/routes/portal/cs/partners.routes';
import csPgConfigRoutes from '@pvpentech/portal/routes/portal/cs/pgConfig.routes';
import csProvisioningRoutes from '@pvpentech/core/routes/portal/cs/provisioning.routes';
import csRefundsRoutes from '@pvpentech/portal/routes/portal/cs/refunds.routes';
import csSettlementsRoutes from '@pvpentech/portal/routes/portal/cs/settlements.routes';
import csSitesRoutes from '@pvpentech/portal/routes/portal/cs/sites.routes';
import csStationsRoutes from '@pvpentech/core/routes/portal/cs/stations.routes';
import csUsersRoutes from '@pvpentech/portal/routes/portal/cs/users.routes';

// Partner portal routes
import partnerBankAccountRoutes from '@pvpentech/portal/routes/portal/partner/bankAccount.routes';
import partnerDashboardRoutes from '@pvpentech/portal/routes/portal/partner/dashboard.routes';
import partnerSettlementsRoutes from '@pvpentech/portal/routes/portal/partner/settlements.routes';
import partnerSitesRoutes from '@pvpentech/portal/routes/portal/partner/sites.routes';
import partnerStationsRoutes from '@pvpentech/portal/routes/portal/partner/stations.routes';
import partnerStatsRoutes from '@pvpentech/portal/routes/portal/partner/stats.routes';

// Customer portal routes
import customerDashboardRoutes from '@pvpentech/portal/routes/portal/customer/dashboard.routes';
import customerHistoryRoutes from '@pvpentech/portal/routes/portal/customer/history.routes';
import customerPaymentCardsRoutes from '@pvpentech/portal/routes/portal/customer/paymentCards.routes';
import customerProfileRoutes from '@pvpentech/portal/routes/portal/customer/profile.routes';
import customerRfidCardsRoutes from '@pvpentech/portal/routes/portal/customer/rfidCards.routes';

// Session + Stats
import { SessionController } from '@pvpentech/portal/controllers/session.controller';
import { sessionService } from '@pvpentech/portal/services/session.service';

// Station admin (core)
import { StationController } from '@pvpentech/core/controllers/station.controller';
import { ocppGateway } from '@pvpentech/core/ocpp/gateway.impl';
import { stationService } from '@pvpentech/core/services/station.service';

// Firmware download (core)
import { firmwareController as _firmwareController } from '@pvpentech/core/controllers/firmware.controller';

const router = Router();
const authController = new AuthController(authService);
const sessionController = new SessionController(sessionService);
const stationController = new StationController(stationService, provisionService);
const provisionController = new ProvisionController(provisionService);

// ─────────────────────────────────────────────
// Mobile App API
// ─────────────────────────────────────────────
router.use('/api', authRoutes);
router.use('/api/charge', chargeRoutes);
router.use('/api/payment', paymentRoutes);
router.use('/provision', provisionRoutes);

// 충전기 측 펌웨어 다운로드
router.get('/firmware/:filename', _firmwareController.download);

// Charger provisioning (device-facing, v2.0 — x-token/x-channel 인증)
/**
 * @swagger
 * /auths:
 *   post:
 *     tags: [Charger Provision]
 *     summary: 충전기 프로비저닝 v2.0 (x-token/x-channel 헤더 인증)
 *     security: []
 *     parameters:
 *       - in: header
 *         name: x-token
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: x-channel
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [origin, model]
 *             properties:
 *               origin:
 *                 type: string
 *               model:
 *                 type: string
 *     responses:
 *       200:
 *         description: 프로비저닝 성공
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Conflict
 */
router.post('/auths', provisionRateLimiter, manufacturerAuth, provisionController.chargerAuth);

// ─────────────────────────────────────────────
// Portal Auth API (public)
// ─────────────────────────────────────────────
/**
 * @swagger
 * /api/portal/auth/login:
 *   post:
 *     tags: [Portal Auth]
 *     summary: 포털 로그인 (CS / 파트너 / 고객 공통)
 *     security: []
 *     parameters:
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: 로그인 성공 (JWT 발급)
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/api/portal/auth/login', loginRateLimiter, authController.loginPortal);
router.post('/api/portal/auth/logout', authController.logout);
router.post('/api/portal/auth/register/customer', authController.registerCustomer);
router.post('/api/portal/auth/register/partner', authController.registerPartner);
router.post('/api/portal/auth/register/cs', authController.registerCs);

// ─────────────────────────────────────────────
// CS Portal API
// ─────────────────────────────────────────────
const csMiddleware = [authMiddleware, requireRole('cs')];

router.use('/api/portal/cs/dashboard', csMiddleware, csDashboardRoutes);
router.use('/api/portal/cs/partners', csMiddleware, csPartnersRoutes);
router.use('/api/portal/cs/sites', csMiddleware, csSitesRoutes);
router.use('/api/portal/cs/stations', csMiddleware, csStationsRoutes);
router.use('/api/portal/cs/users', csMiddleware, csUsersRoutes);
router.use('/api/portal/cs/id-tokens', csMiddleware, csIdTokensRoutes);
router.use('/api/portal/cs/settlements', csMiddleware, csSettlementsRoutes);
router.use('/api/portal/cs/ops', csMiddleware, csOpsRoutes);
router.use('/api/portal/cs/provisioning', csMiddleware, csProvisioningRoutes);
router.use('/api/portal/cs/provisioning/configs', csMiddleware, csChargerConfigsRoutes);
router.use('/api/portal/cs/manufacturers', csMiddleware, csManufacturerRoutes);
router.use('/api/portal/cs/ocpp-commands', csMiddleware, csOcppCommandsRoutes);
router.use('/api/portal/cs/firmware', csMiddleware, csFirmwareRoutes);
router.use('/api/portal/cs/fault-logs', csMiddleware, csFaultLogsRoutes);
router.use('/api/portal/cs/refunds', csMiddleware, csRefundsRoutes);
router.use('/api/portal/cs/pg-configs', csMiddleware, csPgConfigRoutes);

// CS Sessions
/**
 * @swagger
 * /api/portal/cs/sessions:
 *   get:
 *     tags: [CS - Sessions]
 *     summary: CS 포털 — 전체 충전 세션 목록 조회 (필터/페이지네이션)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/PageSizeQuery'
 *     responses:
 *       200:
 *         description: 세션 목록
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/api/portal/cs/sessions', csMiddleware, sessionController.listAll);

// ─────────────────────────────────────────────
// Partner Portal API
// ─────────────────────────────────────────────
const partnerMiddleware = [authMiddleware, requireRole('partner')];

router.use('/api/portal/partner/dashboard', partnerMiddleware, partnerDashboardRoutes);
router.use('/api/portal/partner/sites', partnerMiddleware, partnerSitesRoutes);
router.use('/api/portal/partner/stations', partnerMiddleware, partnerStationsRoutes);
router.use('/api/portal/partner/stats', partnerMiddleware, partnerStatsRoutes);
router.use('/api/portal/partner/settlements', partnerMiddleware, partnerSettlementsRoutes);
router.use('/api/portal/partner/bank-account', partnerMiddleware, partnerBankAccountRoutes);

// ─────────────────────────────────────────────
// Customer Portal API
// ─────────────────────────────────────────────
const customerMiddleware = [authMiddleware, requireRole('customer')];

router.use('/api/portal/customer/dashboard', customerMiddleware, customerDashboardRoutes);
router.use('/api/portal/customer/history', customerMiddleware, customerHistoryRoutes);
router.use('/api/portal/customer/rfid-cards', customerMiddleware, customerRfidCardsRoutes);
router.use('/api/portal/customer/payment-cards', customerMiddleware, customerPaymentCardsRoutes);
router.use('/api/portal/customer/profile', customerMiddleware, customerProfileRoutes);

// ─────────────────────────────────────────────
// Admin OCPP Remote Command API
// ─────────────────────────────────────────────
const adminMiddleware = [authMiddleware, requireRole('cs')];

/**
 * @swagger
 * /api/admin/stations/{stationId}/remote-start:
 *   post:
 *     tags: [Admin OCPP]
 *     summary: 충전기 원격 시작 (RemoteStartTransaction)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AcceptLanguage'
 *       - name: stationId
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idTag]
 *             properties:
 *               connectorId: { type: integer, example: 1 }
 *               idTag: { type: string, example: "RFID123456" }
 *     responses:
 *       200:
 *         description: 명령 전송 결과 (Accepted / Rejected)
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       422:
 *         description: 충전기 오프라인 등 처리 불가
 */
router.post('/api/admin/stations/:stationId/remote-start', adminMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { connectorId, idTag } = req.body;
    const result = await ocppGateway.startSession({ stationId: req.params.stationId, connectorId: connectorId || 1, idTag });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.post('/api/admin/stations/:stationId/remote-stop', adminMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId } = req.body;
    const result = await ocppGateway.stopSession({ stationId: req.params.stationId, transactionId });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.post('/api/admin/stations/:stationId/reset', adminMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type } = req.body;
    const result = await ocppGateway.resetStation({ stationId: req.params.stationId, type: type || 'Soft' });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.post('/api/admin/stations/:stationId/availability', adminMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { connectorId, type } = req.body;
    const result = await ocppGateway.changeAvailability({ stationId: req.params.stationId, connectorId: connectorId || 0, type });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get('/api/admin/stations/:stationId/status', adminMiddleware, (req: Request, res: Response) => {
  const isConnected = ocppGateway.isStationConnected(req.params.stationId);
  res.json({ success: true, data: { stationId: req.params.stationId, isConnected } });
});

router.post('/api/admin/stations/:stationId/update-firmware', adminMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { location, retrieveDate, retries } = req.body;
    const sent = ocppGateway.sendRawCall({
      stationId: req.params.stationId,
      action: 'UpdateFirmware',
      payload: {
        location,
        retrieveDate: retrieveDate || new Date().toISOString(),
        retries: retries ?? 3,
      },
    });
    if (!sent) {
      res.status(422).json({ success: false, error: { code: 'STATION_OFFLINE', message: 'Station is offline' } });
      return;
    }
    res.json({ success: true, data: { messageId: sent.messageId } });
  } catch (error) { next(error); }
});

router.post('/api/admin/stations/:stationId/get-diagnostics', adminMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { location } = req.body;
    const sent = ocppGateway.sendRawCall({
      stationId: req.params.stationId,
      action: 'GetDiagnostics',
      payload: { location },
    });
    if (!sent) {
      res.status(422).json({ success: false, error: { code: 'STATION_OFFLINE', message: 'Station is offline' } });
      return;
    }
    res.json({ success: true, data: { messageId: sent.messageId } });
  } catch (error) { next(error); }
});

router.post('/api/admin/stations/:stationId/change-configuration', adminMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key, value } = req.body;
    const sent = ocppGateway.sendRawCall({
      stationId: req.params.stationId,
      action: 'ChangeConfiguration',
      payload: { key, value: String(value) },
    });
    if (!sent) {
      res.status(422).json({ success: false, error: { code: 'STATION_OFFLINE', message: 'Station is offline' } });
      return;
    }
    res.json({ success: true, data: { messageId: sent.messageId } });
  } catch (error) { next(error); }
});

export default router;
