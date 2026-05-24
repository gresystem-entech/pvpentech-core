// Express Request 타입 확장
import { TFunction } from 'i18next';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        role: string;
      };
      /** manufacturerAuth 미들웨어에서 주입 — /auths 라우트 전용 */
      manufacturer?: {
        id: number;
        channelId: string;
        name: string;
        tokenHash: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      };
      t: TFunction;
      language: string;
      i18n: {
        changeLanguage: (lang: string) => Promise<TFunction>;
      };
    }
  }
}

export {};
