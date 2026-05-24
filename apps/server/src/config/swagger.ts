import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';
import { env } from '@pvpentech/shared/config/env';

const isProduction = env.NODE_ENV === 'production';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Pvpentech CSMS API',
      version: '1.0.0',
      description:
        'EV 충전기 관제 시스템(CSMS) REST API 문서. ' +
        '모바일 앱 / 관리자(CS) / 파트너 / 고객 포털 및 OCPP 관제 명령을 포함한다.',
    },
    servers: [
      {
        url: isProduction ? '/' : `http://localhost:${env.PORT}`,
        description: isProduction ? 'Production' : 'Local development',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '포털/모바일 API 인증용 JWT 토큰. `Authorization: Bearer <token>` 형식.',
        },
        basicAuth: {
          type: 'http',
          scheme: 'basic',
          description: '충전기 프로비저닝(OCPP Security Profile 1) 또는 운영 도구 Basic Auth.',
        },
      },
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'NOT_FOUND' },
                message: { type: 'string', example: 'Route not found' },
              },
            },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            pageSize: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 0 },
            totalPages: { type: 'integer', example: 0 },
          },
        },
      },
      parameters: {
        AcceptLanguage: {
          name: 'Accept-Language',
          in: 'header',
          required: false,
          schema: { type: 'string', enum: ['ko', 'en', 'vi'], example: 'ko' },
          description: '응답 메시지 언어 (한국어/영어/베트남어)',
        },
        PageQuery: {
          name: 'page',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, default: 1 },
        },
        PageSizeQuery: {
          name: 'pageSize',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        },
      },
      responses: {
        Unauthorized: {
          description: '인증 실패 (JWT 누락/만료/유효하지 않음)',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        Forbidden: {
          description: '권한 부족 (역할 불일치)',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        NotFound: {
          description: '리소스를 찾을 수 없음',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        ValidationError: {
          description: '요청 검증 실패',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Mobile Auth', description: '모바일 앱 인증' },
      { name: 'Mobile Charge', description: '모바일 충전 세션' },
      { name: 'Mobile Payment', description: 'MB Bank 결제 / IPN' },
      { name: 'Mobile Provision', description: '모바일 프로비저닝' },
      { name: 'Charger Provision', description: '충전기 디바이스 프로비저닝' },
      { name: 'Portal Auth', description: '포털 인증 (로그인/회원가입)' },
      { name: 'CS - Dashboard', description: 'CS 포털 대시보드' },
      { name: 'CS - Partners', description: 'CS 포털 파트너 관리' },
      { name: 'CS - Sites', description: 'CS 포털 사이트 관리' },
      { name: 'CS - Stations', description: 'CS 포털 충전기 관리' },
      { name: 'CS - Users', description: 'CS 포털 사용자 관리' },
      { name: 'CS - ID Tokens', description: 'CS 포털 RFID/ID 토큰' },
      { name: 'CS - Settlements', description: 'CS 포털 정산' },
      { name: 'CS - Ops', description: 'CS 포털 운영 도구' },
      { name: 'CS - Provisioning', description: 'CS 포털 프로비저닝' },
      { name: 'CS - Charger Configs', description: 'CS 포털 충전기 구성' },
      { name: 'CS - Fault Logs', description: 'CS 포털 장애 로그' },
      { name: 'CS - Refunds', description: 'CS 포털 환불' },
      { name: 'CS - PG Config', description: 'CS 포털 PG 설정' },
      { name: 'CS - Sessions', description: 'CS 포털 충전 세션' },
      { name: 'Partner - Dashboard', description: '파트너 포털 대시보드' },
      { name: 'Partner - Sites', description: '파트너 포털 사이트' },
      { name: 'Partner - Stations', description: '파트너 포털 충전기' },
      { name: 'Partner - Stats', description: '파트너 포털 통계' },
      { name: 'Partner - Settlements', description: '파트너 포털 정산' },
      { name: 'Partner - Bank Account', description: '파트너 포털 계좌' },
      { name: 'Customer - Dashboard', description: '고객 포털 대시보드' },
      { name: 'Customer - History', description: '고객 포털 충전 이력' },
      { name: 'Customer - RFID Cards', description: '고객 포털 RFID 카드' },
      { name: 'Customer - Payment Cards', description: '고객 포털 결제 카드' },
      { name: 'Customer - Profile', description: '고객 포털 프로필' },
      { name: 'Admin OCPP', description: 'OCPP 원격 명령 (CS 권한)' },
    ],
  },
  apis: [
    path.join(__dirname, '../routes/**/*.{ts,js}'),
    path.join(__dirname, '../controllers/**/*.{ts,js}'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
