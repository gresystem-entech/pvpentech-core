/**
 * packages/core/src/internal-api/routes/idTokens.routes.ts
 *
 * Internal API — IdToken CRUD (Phase 3-D, D3)
 *
 * Portal이 IdToken을 Core schema에서 직접 읽지 않고 이 API를 통해 접근하도록 변경.
 *
 * | 메서드 | 경로 | 설명 |
 * |--------|------|------|
 * | GET    | /id-tokens          | 목록 (페이지네이션, status/keyword 필터) |
 * | GET    | /id-tokens/:idTag   | 상세 (user 포함) |
 * | POST   | /id-tokens          | 단건 등록 |
 * | PUT    | /id-tokens/:idTag   | 상태/타입 갱신 |
 * | DELETE | /id-tokens/:idTag   | 삭제 (진행 중 세션 있으면 409) |
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prismaCore as prisma } from '@pvpentech/shared/config/database';
import { InternalApiErrors } from '@pvpentech/shared/errors/internalApiErrors';
import { parsePagination } from '@pvpentech/shared/utils/auth';

const router = Router();

// ─── GET /id-tokens — 목록 ──────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, skip } = parsePagination(
      req.query.page ? Number(req.query.page) : undefined,
      req.query.limit ? Number(req.query.limit) : undefined,
    );

    const keyword = req.query.keyword ? String(req.query.keyword) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;

    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    if (keyword) {
      where['OR'] = [
        { idTag: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.idToken.findMany({
        where,
        include: { user: { select: { id: true, username: true } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.idToken.count({ where }),
    ]);

    res.json({ success: true, data: { items, total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

// ─── GET /id-tokens/:idTag — 상세 ───────────────────────────────────────────

router.get('/:idTag', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idTag } = req.params;
    const token = await prisma.idToken.findUnique({
      where: { idTag },
      include: { user: { select: { id: true, username: true, email: true } } },
    });
    if (!token) {
      throw InternalApiErrors.notFound(`IdToken not found: ${idTag}`);
    }
    res.json({ success: true, data: token });
  } catch (err) {
    next(err);
  }
});

// ─── POST /id-tokens — 등록 ─────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idTag, type, userId, status } = req.body as {
      idTag?: string;
      type?: string;
      userId?: number;
      status?: string;
    };

    if (!idTag) {
      throw InternalApiErrors.badRequest('idTag is required');
    }

    const validTypes = ['Local', 'ISO14443', 'ISO15693', 'KeyCode', 'eMAID', 'Central', 'MacAddress', 'NoAuthorization'];
    const tokenType = validTypes.includes(type ?? '') ? (type as 'Local') : 'Local';

    const token = await prisma.idToken.create({
      data: {
        idTag,
        type: tokenType,
        status: (status as 'Accepted' | undefined) ?? 'Accepted',
        userId: userId ?? null,
      },
    });

    res.status(201).json({ success: true, data: token });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /id-tokens/:idTag — 갱신 ───────────────────────────────────────────

router.put('/:idTag', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idTag } = req.params;
    const { status, type, userId } = req.body as {
      status?: string;
      type?: string;
      userId?: number | null;
    };

    const existing = await prisma.idToken.findUnique({ where: { idTag } });
    if (!existing) {
      throw InternalApiErrors.notFound(`IdToken not found: ${idTag}`);
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) data['status'] = status;
    if (type !== undefined) data['type'] = type;
    if (userId !== undefined) data['userId'] = userId;

    const updated = await prisma.idToken.update({ where: { idTag }, data });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /id-tokens/:idTag — 삭제 ────────────────────────────────────────

router.delete('/:idTag', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idTag } = req.params;

    const token = await prisma.idToken.findUnique({ where: { idTag } });
    if (!token) {
      throw InternalApiErrors.notFound(`IdToken not found: ${idTag}`);
    }

    // 진행 중인 충전 세션 확인 (삭제 안전성 보호)
    const activeSession = await prisma.transaction.findFirst({
      where: { idTag, status: { in: ['Pending', 'Active'] } },
    });
    if (activeSession) {
      throw InternalApiErrors.conflict('IdToken has an active charging session');
    }

    await prisma.idToken.delete({ where: { idTag } });
    res.json({ success: true, data: { idTag, deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
