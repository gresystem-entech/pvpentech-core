# 10. 다국어(i18n) 설계 가이드

- **버전**: v1.0
- **작성일**: 2026-03-31
- **대상**: Node.js 백엔드 개발자, 모바일 앱 개발자, 관리자 포털 개발자
- **목적**: Pvpentech CSMS 플랫폼 전반의 다국어(i18n) 지원 설계 기준 제시

---

## 1. 개요 (Overview)

Pvpentech는 한국어, 영어, 베트남어 3개 언어를 지원합니다. 다국어 지원은 백엔드 API 응답, 모바일 앱 UI, 관리자 포털 UI 전 영역에 적용됩니다.

### 지원 언어

| 언어 코드 | 언어명 | 비고 |
|-----------|--------|------|
| `ko` | 한국어 | 기본 언어(default) |
| `en` | 영어 | 1차 폴백 언어 |
| `vi` | 베트남어 | |

### 폴백(Fallback) 정책

번역 키가 요청 언어에 없을 경우 다음 순서로 폴백합니다.

```
요청 언어 → ko → en → 키 이름 그대로 출력
```

---

## 2. 아키텍처 (Architecture)

```
┌──────────────────────────────────────────────────────────┐
│                    Pvpentech i18n 구조                    │
│                                                          │
│  ┌────────────────┐   Accept-Language 헤더               │
│  │  Android App   │──────────────────────────────────┐  │
│  │  (React Native)│                                  │  │
│  │  i18next       │                                  ▼  │
│  └────────────────┘                    ┌─────────────────┐│
│                                        │  Node.js CSMS   ││
│  ┌────────────────┐   Accept-Language  │  (백엔드 API)   ││
│  │  Admin Portal  │──────────────────►│                 ││
│  │  (Next.js)     │                   │  i18next +      ││
│  │  i18next +     │                   │  i18next-http-  ││
│  │  next-i18next  │                   │  middleware     ││
│  └────────────────┘                   └────────┬────────┘│
│                                                │          │
│                              ┌─────────────────▼──────┐  │
│                              │   locales/              │  │
│                              │   ├── ko/               │  │
│                              │   ├── en/               │  │
│                              │   └── vi/               │  │
│                              └────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 컴포넌트별 i18n 책임

| 컴포넌트 | 라이브러리 | 번역 파일 위치 |
|----------|-----------|---------------|
| 백엔드 API | `i18next` + `i18next-http-middleware` | `locales/{lang}/` (서버 사이드) |
| 모바일 앱 | `i18next` + `react-i18next` | 앱 번들 내 `assets/locales/{lang}/` |
| 관리자 포털 | `i18next` + `react-i18next` (또는 `next-i18next`) | `public/locales/{lang}/` |

---

## 3. 번역 파일 디렉토리 구조

### 3.1 백엔드 (`locales/`)

```
pvpentech-csms/
└── locales/
    ├── ko/
    │   ├── common.json       # 공통 메시지 (성공, 서버오류 등)
    │   ├── error.json        # 에러 메시지
    │   ├── auth.json         # 인증/로그인 관련
    │   ├── charge.json       # 충전 세션 관련
    │   ├── station.json      # 충전기/충전소 관련
    │   ├── user.json         # 사용자 관련
    │   ├── partner.json      # 파트너 관련
    │   └── notification.json # 푸시 알림 메시지
    ├── en/
    │   ├── common.json
    │   ├── error.json
    │   ├── auth.json
    │   ├── charge.json
    │   ├── station.json
    │   ├── user.json
    │   ├── partner.json
    │   └── notification.json
    └── vi/
        ├── common.json
        ├── error.json
        ├── auth.json
        ├── charge.json
        ├── station.json
        ├── user.json
        ├── partner.json
        └── notification.json
```

### 3.2 모바일 앱 (`assets/locales/`)

```
assets/
└── locales/
    ├── ko/
    │   ├── common.json
    │   ├── menu.json
    │   ├── charge.json
    │   └── error.json
    ├── en/
    │   └── (동일 구조)
    └── vi/
        └── (동일 구조)
```

### 3.3 관리자 포털 (`public/locales/`)

```
public/
└── locales/
    ├── ko/
    │   ├── common.json
    │   ├── menu.json
    │   ├── dashboard.json
    │   ├── station.json
    │   └── error.json
    ├── en/
    │   └── (동일 구조)
    └── vi/
        └── (동일 구조)
```

---

## 4. 번역 키 네이밍 컨벤션

### 4.1 기본 규칙

- 네임스페이스(namespace)를 파일명으로 구분합니다 (예: `error`, `charge`, `menu`)
- 키는 `{namespace}.{카테고리}.{세부항목}` 형식의 점 표기법을 사용합니다
- 모두 소문자 camelCase를 사용합니다
- 동적 값은 `{{변수명}}` 중괄호로 표기합니다

### 4.2 네이밍 예시

```
# 에러 메시지 (error.json)
error.unauthorized              → "인증에 실패했습니다."
error.forbidden                 → "접근 권한이 없습니다."
error.notFound                  → "리소스를 찾을 수 없습니다."
error.conflict                  → "이미 존재하는 리소스입니다."
error.validationFailed          → "입력값이 올바르지 않습니다."
error.internalServer            → "서버 내부 오류가 발생했습니다."

# 충전 관련 (charge.json)
charge.stationNotFound          → "존재하지 않는 충전기입니다."
charge.alreadyInUse             → "이미 사용 중인 충전기입니다."
charge.stationOffline           → "충전기가 오프라인 상태입니다."
charge.sessionNotFound          → "존재하지 않는 충전 세션입니다."
charge.completed                → "충전이 완료되었습니다. 이용해 주셔서 감사합니다."
charge.startFailed              → "충전 시작에 실패했습니다."

# 인증 관련 (auth.json)
auth.loginFailed                → "아이디 또는 비밀번호가 틀렸습니다."
auth.tokenExpired               → "로그인이 만료되었습니다. 다시 로그인해주세요."
auth.tokenInvalid               → "유효하지 않은 토큰입니다."

# 메뉴 (menu.json - 앱/포털)
menu.home                       → "홈"
menu.charging.start             → "충전 시작"
menu.charging.history           → "충전 내역"
menu.myPage                     → "마이페이지"
menu.station.list               → "충전소 목록"

# 알림 (notification.json)
notification.chargeGoalReached  → "충전 목표({{value}})에 도달했습니다."
notification.chargeCompleted    → "충전이 완료되었습니다. {{kwh}}kWh 충전"
```

### 4.3 금지 사항

- 번역 키에 한국어 문자를 사용하지 않습니다
- 번역 키를 문장 전체로 만들지 않습니다 (예: `잘못된요청입니다` 금지)
- 동일 의미의 키를 네임스페이스별로 중복 정의하지 않습니다

---

## 5. 백엔드 i18n 구현

### 5.1 패키지 설치

```bash
npm install i18next i18next-http-middleware i18next-fs-backend
```

### 5.2 i18next 초기화

```typescript
// src/config/i18n.ts
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import middleware from 'i18next-http-middleware';
import path from 'path';

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
      fallbackLng: 'ko',        // 기본 언어: 한국어
      preload: ['ko', 'en', 'vi'],
      ns: ['common', 'error', 'auth', 'charge', 'station', 'user', 'partner', 'notification'],
      defaultNS: 'common',
      interpolation: {
        escapeValue: false,
      },
    });
}
```

### 5.3 Express 앱에 미들웨어 등록

```typescript
// src/app.ts
import express from 'express';
import middleware from 'i18next-http-middleware';
import i18next from 'i18next';
import { initI18n } from '@config/i18n';

export async function createApp(): Promise<express.Application> {
  await initI18n();

  const app = express();

  // i18n 미들웨어 - 모든 라우터보다 먼저 등록
  app.use(middleware.handle(i18next));

  // ... 나머지 미들웨어 및 라우터 등록
  return app;
}
```

### 5.4 Accept-Language 헤더 파싱 우선순위

요청의 언어 결정 우선순위는 다음과 같습니다.

```
1순위: Accept-Language 헤더 (예: Accept-Language: vi, en;q=0.9, ko;q=0.8)
2순위: 쿼리스트링 ?lang=en
3순위: 사용자 DB 저장 언어 설정 (서비스 레이어에서 수동 적용)
4순위: 기본값 ko
```

### 5.5 사용자 DB 저장 언어 설정 폴백

사용자가 앱/포털에서 선택한 언어가 DB에 저장된 경우, 서비스 레이어에서 명시적으로 적용합니다.

```typescript
// src/middlewares/userLanguage.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { UserRepository } from '@repositories/user.repository';

// 인증 미들웨어 이후에 등록 (req.user 필요)
export async function userLanguageMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Accept-Language 헤더가 명시적으로 있으면 헤더 우선
    const hasExplicitLang = req.headers['accept-language'];
    if (hasExplicitLang) {
      return next();
    }

    // 로그인된 사용자의 DB 저장 언어 적용
    if (req.user?.id) {
      const userRepo = new UserRepository();
      const user = await userRepo.findById(req.user.id);
      if (user?.language && ['ko', 'en', 'vi'].includes(user.language)) {
        req.language = user.language;
        req.i18n.changeLanguage(user.language);
      }
    }
  } catch {
    // 언어 설정 실패는 무시하고 기본값 사용
  }
  next();
}
```

### 5.6 서비스 레이어에서 번역 사용

```typescript
// src/services/charge.service.ts
import { NotFoundError, ConflictError } from '@utils/errors';
import { TFunction } from 'i18next';

export class ChargeService {
  async startCharge(params: StartChargeParams, t: TFunction): Promise<{ sessionId: string }> {
    const station = await this.stationRepo.findById(params.qrCode);
    if (!station || !station.isActive) {
      throw new NotFoundError(t('charge:charge.stationNotFound'));
    }

    const activeSession = await this.transactionRepo.findActiveByStation(params.qrCode);
    if (activeSession) {
      throw new ConflictError(t('charge:charge.alreadyInUse'));
    }

    if (!connectionManager.isConnected(params.qrCode)) {
      throw new Error(t('charge:charge.stationOffline'));
    }

    // ... 충전 세션 생성
  }
}
```

### 5.7 컨트롤러에서 t 함수 전달

```typescript
// src/controllers/charge.controller.ts
import { Request, Response, NextFunction } from 'express';
import { ChargeService } from '@services/charge.service';

export class ChargeController {
  constructor(private chargeService: ChargeService) {}

  startCharge = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = startChargeSchema.parse({ /* ... */ });

      // req.t는 i18next-http-middleware가 주입하는 번역 함수
      const result = await this.chargeService.startCharge(params, req.t);

      res.json({ success: true, sessionId: result.sessionId });
    } catch (error) {
      next(error);
    }
  };
}
```

### 5.8 API 응답 에러 메시지 다국어 예시

클라이언트의 `Accept-Language: vi` 헤더에 따라 에러 메시지가 베트남어로 반환됩니다.

```http
POST /api/charge/start?qr_code=CP001&user_id=user1&goal_type=kwh&goal_value=10
Accept-Language: vi
Authorization: Bearer eyJ...
```

```json
// 응답 (베트남어)
HTTP/1.1 409 Conflict
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Trạm sạc đang được sử dụng."
  }
}
```

```http
Accept-Language: en
```

```json
// 응답 (영어)
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "The charging station is already in use."
  }
}
```

---

## 6. 모바일 앱 i18n 구현 (React Native)

### 6.1 패키지 설치

```bash
npm install i18next react-i18next
npm install react-native-localize  # 기기 언어 감지용
```

### 6.2 i18next 초기화

```typescript
// src/i18n/index.ts (React Native)
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'react-native-localize';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 번역 파일 import
import ko_common from '../../assets/locales/ko/common.json';
import ko_charge from '../../assets/locales/ko/charge.json';
import en_common from '../../assets/locales/en/common.json';
import en_charge from '../../assets/locales/en/charge.json';
import vi_common from '../../assets/locales/vi/common.json';
import vi_charge from '../../assets/locales/vi/charge.json';

const SUPPORTED_LANGUAGES = ['ko', 'en', 'vi'];
const DEFAULT_LANGUAGE = 'ko';

async function detectLanguage(): Promise<string> {
  // 1순위: 앱 내 저장된 사용자 설정
  const savedLang = await AsyncStorage.getItem('user_language');
  if (savedLang && SUPPORTED_LANGUAGES.includes(savedLang)) {
    return savedLang;
  }

  // 2순위: 기기 언어
  const deviceLocales = getLocales();
  for (const locale of deviceLocales) {
    const lang = locale.languageCode;
    if (SUPPORTED_LANGUAGES.includes(lang)) {
      return lang;
    }
  }

  // 3순위: 기본값 ko
  return DEFAULT_LANGUAGE;
}

export async function initI18n(): Promise<void> {
  const language = await detectLanguage();

  await i18next
    .use(initReactI18next)
    .init({
      resources: {
        ko: { common: ko_common, charge: ko_charge },
        en: { common: en_common, charge: en_charge },
        vi: { common: vi_common, charge: vi_charge },
      },
      lng: language,
      fallbackLng: ['ko', 'en'],
      ns: ['common', 'charge', 'menu', 'error'],
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });
}
```

### 6.3 언어 감지 순서

```
1순위: AsyncStorage에 저장된 앱 내 사용자 설정 (언어 변경 시 저장)
2순위: 기기 언어 (react-native-localize로 감지)
3순위: 기본값 ko
```

### 6.4 컴포넌트에서 사용

```typescript
// src/screens/ChargingScreen.tsx
import { useTranslation } from 'react-i18next';

export function ChargingScreen() {
  const { t } = useTranslation('charge');

  return (
    <View>
      <Text>{t('charge.completed')}</Text>
      <Text>{t('charge:charge.stationNotFound')}</Text>
    </View>
  );
}
```

### 6.5 언어 변경 함수

```typescript
// src/utils/changeLanguage.ts
import i18next from 'i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function changeLanguage(lang: string): Promise<void> {
  await AsyncStorage.setItem('user_language', lang);
  await i18next.changeLanguage(lang);

  // 서버에 사용자 언어 설정 저장 (선택적)
  await api.put('/api/portal/customer/profile', { language: lang });
}
```

---

## 7. 관리자 포털 i18n 구현 (React/Next.js)

### 7.1 패키지 설치 (Next.js 기준)

```bash
npm install next-i18next react-i18next i18next
```

### 7.2 next-i18next 설정

```javascript
// next-i18next.config.js
module.exports = {
  i18n: {
    defaultLocale: 'ko',
    locales: ['ko', 'en', 'vi'],
  },
  localePath: './public/locales',
  fallbackLng: {
    default: ['ko', 'en'],
  },
  ns: ['common', 'menu', 'dashboard', 'station', 'error'],
  defaultNS: 'common',
};
```

### 7.3 컴포넌트에서 사용

```typescript
// pages/dashboard/index.tsx
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

export default function DashboardPage() {
  const { t, i18n } = useTranslation(['common', 'dashboard']);

  return (
    <div>
      <h1>{t('dashboard:dashboard.title')}</h1>
      <p>{t('common:menu.home')}</p>
    </div>
  );
}

export async function getServerSideProps({ locale }: { locale: string }) {
  return {
    props: {
      ...(await serverSideTranslations(locale, ['common', 'dashboard'])),
    },
  };
}
```

### 7.4 언어 전환 컴포넌트

```typescript
// components/LanguageSwitcher.tsx
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';

const LANGUAGES = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'vi', label: 'Tiếng Việt' },
];

export function LanguageSwitcher() {
  const router = useRouter();
  const { i18n } = useTranslation();

  const handleChange = (lang: string) => {
    router.push(router.pathname, router.asPath, { locale: lang });
  };

  return (
    <select value={i18n.language} onChange={(e) => handleChange(e.target.value)}>
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
```

---

## 8. 번역 파일 예시

### 8.1 `locales/ko/error.json`

```json
{
  "unauthorized": "인증에 실패했습니다.",
  "forbidden": "접근 권한이 없습니다.",
  "notFound": "리소스를 찾을 수 없습니다.",
  "conflict": "이미 존재하는 리소스입니다.",
  "validationFailed": "입력값이 올바르지 않습니다.",
  "internalServer": "서버 내부 오류가 발생했습니다."
}
```

### 8.2 `locales/en/error.json`

```json
{
  "unauthorized": "Authentication failed.",
  "forbidden": "You do not have permission to access this resource.",
  "notFound": "The requested resource was not found.",
  "conflict": "The resource already exists.",
  "validationFailed": "Invalid input value.",
  "internalServer": "An internal server error occurred."
}
```

### 8.3 `locales/vi/error.json`

```json
{
  "unauthorized": "Xác thực thất bại.",
  "forbidden": "Bạn không có quyền truy cập tài nguyên này.",
  "notFound": "Không tìm thấy tài nguyên yêu cầu.",
  "conflict": "Tài nguyên đã tồn tại.",
  "validationFailed": "Giá trị đầu vào không hợp lệ.",
  "internalServer": "Đã xảy ra lỗi máy chủ nội bộ."
}
```

### 8.4 `locales/ko/charge.json`

```json
{
  "stationNotFound": "존재하지 않는 충전기입니다.",
  "alreadyInUse": "이미 사용 중인 충전기입니다.",
  "stationOffline": "충전기가 오프라인 상태입니다.",
  "sessionNotFound": "존재하지 않는 충전 세션입니다.",
  "completed": "충전이 완료되었습니다. 이용해 주셔서 감사합니다.",
  "startFailed": "충전 시작에 실패했습니다.",
  "goalReached": "충전 목표 {{value}}에 도달했습니다."
}
```

### 8.5 `locales/en/charge.json`

```json
{
  "stationNotFound": "The charging station does not exist.",
  "alreadyInUse": "The charging station is already in use.",
  "stationOffline": "The charging station is offline.",
  "sessionNotFound": "The charging session does not exist.",
  "completed": "Charging completed. Thank you for using our service.",
  "startFailed": "Failed to start charging.",
  "goalReached": "Charging goal {{value}} has been reached."
}
```

### 8.6 `locales/vi/charge.json`

```json
{
  "stationNotFound": "Trạm sạc không tồn tại.",
  "alreadyInUse": "Trạm sạc đang được sử dụng.",
  "stationOffline": "Trạm sạc đang ngoại tuyến.",
  "sessionNotFound": "Phiên sạc không tồn tại.",
  "completed": "Sạc hoàn tất. Cảm ơn bạn đã sử dụng dịch vụ của chúng tôi.",
  "startFailed": "Không thể bắt đầu sạc.",
  "goalReached": "Đã đạt mục tiêu sạc {{value}}."
}
```

---

## 9. 누락 번역 처리 방침

### 9.1 폴백 순서

```
요청 언어(vi/en) 번역 키 없음
  → ko 폴백 시도
  → en 폴백 시도
  → 번역 키 문자열 그대로 출력 (예: "charge.stationNotFound")
```

### 9.2 누락 번역 로깅

```typescript
// src/config/i18n.ts (추가 설정)
await i18next.init({
  // ... 기존 설정 ...
  saveMissing: true,
  missingKeyHandler: (lngs, ns, key) => {
    logger.warn({ lngs, ns, key }, 'Missing translation key');
  },
});
```

### 9.3 누락 번역 발견 시 처리

1. `warn` 레벨로 로그 기록
2. 슬랙 알림 채널에 자동 전송 (선택적, BullMQ job 활용)
3. 한국어(ko) 번역을 우선 폴백으로 사용하여 사용자에게 메시지 표시
4. 다음 번역 작업 사이클에서 해당 키 추가

---

## 10. 번역 작업 프로세스

새로운 메시지를 추가할 때는 반드시 3개 언어를 동시에 작성합니다.

### 10.1 새 메시지 추가 절차

```
1. 번역 키 이름 결정 (네이밍 컨벤션 준수)
2. locales/ko/{namespace}.json 에 한국어 번역 추가
3. locales/en/{namespace}.json 에 영어 번역 추가
4. locales/vi/{namespace}.json 에 베트남어 번역 추가
5. PR에 3개 파일 변경 포함 여부 확인 (리뷰어 체크 필수)
```

### 10.2 번역 키 추가 예시 (PR 체크리스트)

```markdown
## 번역 키 추가 체크리스트
- [ ] locales/ko/{ns}.json 번역 추가
- [ ] locales/en/{ns}.json 번역 추가
- [ ] locales/vi/{ns}.json 번역 추가
- [ ] 동적 변수({{value}}) 3개 언어 모두 동일하게 사용
- [ ] 번역 키 네이밍 컨벤션 준수 (camelCase, 점 표기법)
```

### 10.3 번역 검증 스크립트

```typescript
// scripts/validateTranslations.ts
import fs from 'fs';
import path from 'path';

const LANGUAGES = ['ko', 'en', 'vi'];
const NAMESPACES = ['common', 'error', 'auth', 'charge', 'station', 'user', 'partner'];

function getAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      return getAllKeys(value as Record<string, unknown>, fullKey);
    }
    return [fullKey];
  });
}

async function validateTranslations(): Promise<void> {
  const baseKeys: Record<string, string[]> = {};

  // ko를 기준 키 목록으로 사용
  for (const ns of NAMESPACES) {
    const koPath = path.join('locales', 'ko', `${ns}.json`);
    if (fs.existsSync(koPath)) {
      const koData = JSON.parse(fs.readFileSync(koPath, 'utf-8'));
      baseKeys[ns] = getAllKeys(koData);
    }
  }

  let hasError = false;

  for (const lang of ['en', 'vi']) {
    for (const ns of NAMESPACES) {
      const filePath = path.join('locales', lang, `${ns}.json`);
      if (!fs.existsSync(filePath)) {
        console.error(`[MISSING FILE] locales/${lang}/${ns}.json`);
        hasError = true;
        continue;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const keys = getAllKeys(data);

      for (const baseKey of baseKeys[ns] ?? []) {
        if (!keys.includes(baseKey)) {
          console.error(`[MISSING KEY] locales/${lang}/${ns}.json: ${baseKey}`);
          hasError = true;
        }
      }
    }
  }

  if (hasError) {
    process.exit(1);
  } else {
    console.log('All translations are valid.');
  }
}

validateTranslations();
```

---

## 11. 체크리스트

- [ ] `i18next`, `i18next-http-middleware`, `i18next-fs-backend` 패키지 설치
- [ ] `locales/{ko,en,vi}/` 디렉토리 및 기본 JSON 파일 생성
- [ ] `src/config/i18n.ts` i18next 초기화 설정 완료
- [ ] Express 앱에 `middleware.handle(i18next)` 등록 (라우터보다 앞에 위치)
- [ ] 에러 클래스 생성자에서 하드코딩 메시지 대신 번역 키 사용
- [ ] 전역 에러 핸들러에서 `req.t` 활용하여 다국어 메시지 반환
- [ ] 모바일 앱 `i18next` + `react-i18next` 초기화 완료
- [ ] 관리자 포털 `next-i18next` 설정 완료
- [ ] 번역 검증 스크립트(`scripts/validateTranslations.ts`) 작성 및 CI에 추가
- [ ] 새 번역 키 추가 시 3개 언어 동시 작성 PR 규칙 팀 내 공유
- [ ] `missingKeyHandler` 로깅 설정으로 누락 번역 모니터링
