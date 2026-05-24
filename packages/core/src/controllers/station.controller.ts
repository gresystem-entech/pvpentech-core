import { ProvisionService } from '@pvpentech/core/services/provision.service';
import { StationService } from '@core/services/station.service';
import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

const createStationSchema = z.object({
  id: z.string().regex(/^EN\d{7}$/, 'Station ID must be "EN" + 7 digits'),
  siteId: z.coerce.number().int().positive().optional(),
  manufacturer: z.string().optional(),
  serialNumber: z.string().optional(),
  firmwareVersion: z.string().optional(),
});

const faultLogSchema = z.object({
  faultType: z.enum(['ConnectorFault', 'CommunicationError', 'PowerFault', 'Other']),
  description: z.string().optional(),
});

export class StationController {
  constructor(private stationService: StationService, private provisioningService: ProvisionService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.stationService.list({
        status: req.query.status as string,
        keyword: req.query.keyword as string,
        page: req.query.page as unknown as number,
        limit: req.query.limit as unknown as number,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const station = await this.stationService.findById(req.params.id);
      res.json({ success: true, data: station });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = createStationSchema.parse(req.body);
      const station = await this.stationService.create(data);
      res.status(201).json({ success: true, data: station });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const station = await this.stationService.update(req.params.id, req.body);
      res.json({ success: true, data: station });
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const provisioning = await this.provisioningService.findByStationId(req.params.id);
      if (provisioning) {
        await this.provisioningService.deleteByStationId(req.params.id);
      }
      await this.stationService.delete(req.params.id);
      res.json({ success: true, data: { message: '충전기가 비활성화되었습니다.' } });
    } catch (error) {
      next(error);
    }
  };

  addFaultLog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = faultLogSchema.parse(req.body);
      const log = await this.stationService.addFaultLog(req.params.id, {
        ...data,
        reportedBy: req.user?.username || 'unknown',
      });
      res.status(201).json({ success: true, data: log });
    } catch (error) {
      next(error);
    }
  };

  getFaultLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.stationService.getFaultLogs(
        req.params.id,
        Number(req.query.page) || 1,
        Number(req.query.limit) || 20
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const password = await this.stationService.resetPassword(req.params.id);
      res.json({ success: true, data: { password } });
    } catch (error) {
      next(error);
    }
  };

  getOnlineStations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stations = await this.stationService.getOnlineStations();
      res.json({ success: true, data: { items: stations, total: stations.length } });
    } catch (error) {
      next(error);
    }
  };
}
