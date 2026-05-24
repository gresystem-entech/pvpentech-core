import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import middleware from 'i18next-http-middleware';
import path from 'path';
import { logger } from '../config/logger';

export async function initI18n(): Promise<void> {
  await i18next
    .use(Backend)
    .use(middleware.LanguageDetector)
    .init({
      backend: {
        loadPath: path.join(process.cwd(), 'locales/{{lng}}/{{ns}}.json'),
      },
      detection: {
        // Accept-Language 헤더 우선 사용
        order: ['header', 'querystring'],
        lookupHeader: 'accept-language',
        lookupQuerystring: 'lang',
        caches: false,
      },
      fallbackLng: 'ko',       // 기본 언어: 한국어
      preload: ['ko', 'en', 'vi'],
      ns: ['common', 'error', 'auth', 'charge', 'station', 'user', 'partner', 'notification', 'portal', 'provisioning'],
      defaultNS: 'common',
      interpolation: {
        escapeValue: false,
      },
      saveMissing: true,
      missingKeyHandler: (lngs, ns, key) => {
        logger.warn({ lngs, ns, key }, 'Missing translation key');
      },
    });
}

export { i18next };
export { i18next as i18n };
