import { z } from 'zod';

const plainTokenSchema = z
  .string()
  .min(16, 'plainToken은 최소 16자 이상이어야 합니다.')
  .max(128, 'plainToken은 최대 128자까지 허용됩니다.')
  .regex(/^[A-Za-z0-9_\-]+$/, 'plainToken은 영문/숫자/언더스코어/하이픈만 허용됩니다.');

export const createManufacturerSchema = z.object({
  channelId: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9_\-]+$/, 'channelId는 영문/숫자/언더스코어/하이픈만 허용됩니다.'),
  name: z.string().min(1).max(100),
  // 옵션: 펌웨어에 이미 박힌 기존 토큰을 그대로 등록하기 위한 임포트 필드.
  // 미지정 시 서버가 64자 hex 랜덤 토큰을 새로 발급한다 (기존 동작).
  plainToken: plainTokenSchema.optional(),
});

export const updateManufacturerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const regenerateTokenSchema = z.object({
  // 옵션: 신규 펌웨어 출시 등으로 특정 토큰 값으로 갱신해야 할 때 사용.
  // 미지정 시 서버가 새 랜덤 토큰을 발급 (기존 동작).
  plainToken: plainTokenSchema.optional(),
});

export type CreateManufacturerDto = z.infer<typeof createManufacturerSchema>;
export type UpdateManufacturerDto = z.infer<typeof updateManufacturerSchema>;
export type RegenerateTokenDto = z.infer<typeof regenerateTokenSchema>;
