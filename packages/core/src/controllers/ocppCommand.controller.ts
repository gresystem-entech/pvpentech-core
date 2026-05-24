import { Request, Response, NextFunction } from 'express';
import { ocppCommandResultService } from '@core/services/ocppCommandResult.service';
import { NotFoundError } from '@pvpentech/shared/errors';

export class OcppCommandController {
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const stationId = req.query.stationId ? String(req.query.stationId) : undefined;
      const action = req.query.action ? String(req.query.action) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const requestedBy = req.query.requestedBy ? String(req.query.requestedBy) : undefined;
      const sentFrom = req.query.sentFrom ? new Date(String(req.query.sentFrom)) : undefined;
      const sentTo = req.query.sentTo ? new Date(String(req.query.sentTo)) : undefined;

      const result = await ocppCommandResultService.list({
        page,
        limit,
        stationId,
        action,
        status,
        requestedBy,
        sentFrom,
        sentTo,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const item = await ocppCommandResultService.findById(Number(req.params.id));
      if (!item) {
        throw new NotFoundError('명령 결과를 찾을 수 없습니다.', 'ocppCommand:notFound');
      }
      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  };

  stats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const days = req.query.days ? Math.max(1, Math.min(90, Number(req.query.days))) : 7;
      const data = await ocppCommandResultService.statsByStatus(days);
      res.json({ success: true, data: { days, statusCounts: data } });
    } catch (err) {
      next(err);
    }
  };
}

export const ocppCommandController = new OcppCommandController();
