import { z } from 'zod';

export const createStationSchema = z.object({
  id: z.string().regex(/^EN\d{7}$/, 'Station ID must be EN + 7 digits'),
  siteId: z.number().int().positive().optional(),
  modelName: z.string().max(100).optional(),
  manufacturer: z.string().max(100).optional(),
  serialNumber: z.string().max(100).optional(),
  firmwareVersion: z.string().max(50).optional(),
});

export const updateStationSchema = createStationSchema.partial().omit({ id: true });

export type CreateStationInput = z.infer<typeof createStationSchema>;
export type UpdateStationInput = z.infer<typeof updateStationSchema>;
