# i18n 설계 작업 결과 요약

- **작업일**: 2026-03-31
- **작업자**: Project Design Architect Agent
- **관련 문서**: `documents/design_guide/10_i18n_design.md`

---

## 작업 개요

Pvpentech CSMS 플랫폼에 다국어(i18n) 지원 요구사항이 추가됨에 따라, 신규 설계 가이드를 작성하고 기존 4개 가이드 문서를 업데이트했습니다.

---

## 작업 1: 신규 i18n 디자인 가이드 작성

### 파일
- `D:/projects/pvpentech2/documents/design_guide/10_i18n_design.md`

### 주요 내용

| 항목 | 내용 |
|------|------|
| 지원 언어 | 한국어(ko, 기본), 영어(en), 베트남어(vi) |
| 폴백 정책 | 요청 언어 → ko → en → 키 이름 그대로 출력 |
| 백엔드 라이브러리 | `i18next` + `i18next-http-middleware` + `i18next-fs-backend` |
| 모바일 앱 라이브러리 | `i18next` + `react-i18next` + `react-native-localize` |
| 관리자 포털 라이브러리 | `i18next` + `next-i18next` |
| 번역 파일 위치 | `locales/{ko,en,vi}/{namespace}.json` |
| 언어 감지 우선순위 (백엔드) | Accept-Language 헤더 → ?lang 쿼리스트링 → DB 저장값 → ko |
| 언어 감지 우선순위 (앱) | AsyncStorage 저장값 → 기기 언어 → ko |

### 번역 키 네이밍 컨벤션

```
{namespace}:{카테고리}.{세부항목}

예시:
  error:unauthorized
  error:notFound
  charge:stationNotFound
  charge:alreadyInUse
  menu.charging.start
  notification.chargeCompleted
```

### 번역 파일 네임스페이스 목록

`common`, `error`, `auth`, `charge`, `station`, `user`, `partner`, `notification`

---

## 작업 2: 기존 디자인 가이드 업데이트

### 2-1. `01_system_architecture.md` 업데이트

| 변경 위치 | 변경 내용 |
|-----------|-----------|
| 섹션 1 개요 | "핵심 요구사항" 테이블 추가 — 다국어(i18n) 지원을 시스템 핵심 요구사항으로 명시 |
| 섹션 4 기술 스택 | `i18next` + `i18next-http-middleware` 행 추가 |
| 섹션 7 체크리스트 | i18next 초기화 및 번역 파일 구성 완료 항목 추가 |

### 2-2. `05_rest_api_design.md` 업데이트

| 변경 위치 | 변경 내용 |
|-----------|-----------|
| 섹션 2 공통 규칙 | "2.0 공통 요청 헤더" 섹션 신규 추가 — `Accept-Language`를 공통 헤더로 명시 |
| `ApiErrorResponse` 타입 | `message` 필드에 "Accept-Language 기반 다국어" 주석 추가 |
| 에러 응답 예시 | `Accept-Language: vi` 기반 베트남어 에러 응답 예시 추가 |
| 섹션 8 체크리스트 | i18n 관련 항목 3개 추가 |

**Accept-Language 헤더 동작 우선순위**:
```
Accept-Language 헤더 → ?lang 쿼리스트링 → 기본값 ko
```

### 2-3. `07_error_handling.md` 업데이트

| 변경 위치 | 변경 내용 |
|-----------|-----------|
| 섹션 1 개요 | 목표 항목에 "에러 코드/메시지 분리" 추가 |
| 섹션 2 에러 클래스 | `messageKey` 선택적 필드 추가, 도메인별 번역 키 사용 예시 추가 |
| 섹션 3 전역 에러 핸들러 | `req.t(error.messageKey)` 번역 적용 로직 추가 |
| 앱 호환 에러 핸들러 | `detail` 필드에도 다국어 메시지 반환하도록 업데이트 |
| 다국어 에러 응답 예시 | ko/en/vi 3개 언어 응답 예시 추가 |
| 서비스 레이어 패턴 | 에러 throw 시 `messageKey` 명시 패턴 추가 |
| 섹션 8 체크리스트 | i18n 관련 항목 3개 추가 |

**핵심 패턴 — 에러 코드와 번역 키 분리**:

```
code       → 클라이언트 로직 분기용 고정 영문값 (언어 무관)
messageKey → i18next 번역 키 (전역 에러 핸들러에서 번역)
message    → req.t(messageKey)로 생성된 최종 다국어 문자열
```

### 2-4. `02_project_directory_structure.md` 업데이트

| 변경 위치 | 변경 내용 |
|-----------|-----------|
| 최상위 디렉토리 구조 | `locales/` 디렉토리 전체 구조 추가 (ko/en/vi 하위 8개 네임스페이스 파일) |
| `src/config/` | `i18n.ts` 파일 추가 |
| `src/middlewares/` | `appErrorHandler.middleware.ts`, `userLanguage.middleware.ts` 추가 |
| `scripts/` | `validateTranslations.ts` 번역 검증 스크립트 추가 |
| 체크리스트 | `locales/` 생성, i18n 초기화, 번역 검증 스크립트 항목 추가 |

---

## 핵심 설계 결정 사항

### 1. 에러 코드와 메시지 분리

기존에는 에러 클래스 생성자에서 한국어 메시지를 하드코딩했습니다. 변경 후에는 `messageKey`를 별도 필드로 관리하여 전역 에러 핸들러에서 `req.t(messageKey)`로 번역합니다. 이 구조는 클라이언트가 `code` 필드로 로직 분기를 수행하면서, `message` 필드는 사용자에게 표시하는 현지화 문자열로 완전히 분리합니다.

### 2. 기본 언어는 한국어

Pvpentech의 주요 시장이 한국임을 고려하여 기본 언어를 `ko`로 설정했습니다. `Accept-Language` 헤더가 없거나 지원하지 않는 언어 코드인 경우 한국어로 폴백합니다.

### 3. 번역 파일 서버 사이드 로딩

백엔드는 `i18next-fs-backend`를 사용하여 서버 시작 시 `locales/` 디렉토리에서 번역 파일을 로드합니다. 번역 파일은 서버 코드와 별도 디렉토리에 위치하여, 번역 담당자가 코드 변경 없이 JSON 파일만 수정할 수 있습니다.

### 4. 번역 검증 자동화

`scripts/validateTranslations.ts`를 CI 파이프라인에 추가하여, ko 기준 번역 키가 en/vi에 누락된 경우 빌드를 실패시킵니다. 이를 통해 번역 누락으로 인한 키 이름 노출을 방지합니다.

---

## 영향 범위

| 레이어 | 변경 범위 |
|--------|-----------|
| 백엔드 미들웨어 | i18next-http-middleware 추가, 에러 핸들러 번역 로직 추가 |
| 백엔드 서비스 레이어 | 에러 throw 시 messageKey 명시 필요 |
| 에러 클래스 | messageKey 선택적 필드 추가 (하위 호환) |
| 디렉토리 구조 | locales/ 디렉토리 신규 생성 |
| 모바일 앱 | i18next + react-i18next 도입 |
| 관리자 포털 | next-i18next 도입 |

---

## 후속 작업

- [ ] `locales/{ko,en,vi}/` 디렉토리 생성 및 초기 번역 JSON 파일 작성
- [ ] `src/config/i18n.ts` 구현
- [ ] 기존 에러 클래스에 `messageKey` 필드 추가
- [ ] 전역 에러 핸들러 `req.t()` 번역 로직 적용
- [ ] `scripts/validateTranslations.ts` 작성 및 CI 등록
- [ ] 베트남어 번역 담당자 지정 및 번역 작업 시작
