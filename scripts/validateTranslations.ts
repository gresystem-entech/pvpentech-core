import fs from 'fs';
import path from 'path';

const LANGUAGES = ['ko', 'en', 'vi'];
const NAMESPACES = ['common', 'error', 'auth', 'charge', 'station', 'user', 'partner', 'notification'];
const LOCALES_DIR = path.join(process.cwd(), 'locales');

function getAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return getAllKeys(value as Record<string, unknown>, fullKey);
    }
    return [fullKey];
  });
}

function validateTranslations(): void {
  const baseKeys: Record<string, string[]> = {};
  let hasError = false;

  // Load ko as the base reference
  for (const ns of NAMESPACES) {
    const koPath = path.join(LOCALES_DIR, 'ko', `${ns}.json`);
    if (!fs.existsSync(koPath)) {
      console.error(`[MISSING BASE FILE] locales/ko/${ns}.json`);
      hasError = true;
      continue;
    }
    const koData = JSON.parse(fs.readFileSync(koPath, 'utf-8')) as Record<string, unknown>;
    baseKeys[ns] = getAllKeys(koData);
  }

  // Compare en and vi against ko
  for (const lang of ['en', 'vi']) {
    for (const ns of NAMESPACES) {
      const filePath = path.join(LOCALES_DIR, lang, `${ns}.json`);

      if (!fs.existsSync(filePath)) {
        console.error(`[MISSING FILE] locales/${lang}/${ns}.json`);
        hasError = true;
        continue;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      const keys = getAllKeys(data);
      const base = baseKeys[ns] ?? [];

      for (const baseKey of base) {
        if (!keys.includes(baseKey)) {
          console.error(`[MISSING KEY] locales/${lang}/${ns}.json -> ${baseKey}`);
          hasError = true;
        }
      }

      // Warn about extra keys in non-ko files that don't exist in ko
      for (const key of keys) {
        if (!base.includes(key)) {
          console.warn(`[EXTRA KEY] locales/${lang}/${ns}.json -> ${key} (not in ko)`);
        }
      }
    }
  }

  if (hasError) {
    console.error('\nTranslation validation FAILED.');
    process.exit(1);
  } else {
    console.log('\nAll translations are valid.');
  }
}

validateTranslations();
