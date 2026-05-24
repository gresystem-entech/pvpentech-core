import { z } from 'zod';

export const uploadFirmwareSchema = z.object({
  version: z.string().min(1).max(50),
  chargerModel: z.string().max(100).optional(),
  chargerVendor: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export const updateFirmwareSchema = z.object({
  version: z.string().min(1).max(50).optional(),
  chargerModel: z.string().max(100).optional(),
  chargerVendor: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

export const startCampaignSchema = z.object({
  targetFilter: z
    .object({
      stationIds: z.array(z.string().min(1).max(50)).max(1000).optional(),
      model: z.string().max(100).optional(),
      vendor: z.string().max(100).optional(),
      siteId: z.number().int().positive().optional(),
    })
    .refine(
      (v) => (v.stationIds && v.stationIds.length > 0) || v.model || v.vendor || v.siteId,
      { message: 'stationIds, model, vendor, siteId 중 최소 한 가지는 지정해야 합니다.' },
    ),
  notes: z.string().max(1000).optional(),
});
