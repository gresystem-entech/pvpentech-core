# 파트너 관리 기능 상세 구현 계획

- **작성일**: 2026-04-15
- **참조**: `documents/design_ref/partner_details.md`

---

## 1. 현황 분석 (Gap Analysis)

### 1.1 요구사항 vs 구현 현황

| 요구사항 | 현재 구현 | 상태 |
|---------|-----------|------|
| 파트너 목록 (아이디, 사업자명, 번호, 연락처, 상태, 등록일) | 구현됨 (단, 불필요한 전체 사이트/충전기 데이터 포함) | ⚠️ 최적화 필요 |
| 파트너 검색 (아이디, **사업자명**, **사업자번호**) | username + email만 검색 → 사업자명/번호 **누락** | ❌ 버그 |
| 파트너 상세 (기본정보 + 계좌정보 + 리베이트 + 충전이력) | 기본 정보/계좌/리베이트 탭 구현, 충전이력 탭 구현 | ✅ |
| 파트너 승인/반려/비활성화 | 구현됨 | ✅ |
| **파트너 생성** (CS가 직접 등록) | `POST /` → stub (list 핸들러 재사용 중) | ❌ 미구현 |
| **파트너 수정** (기본정보) | `PUT /:id` → stub (findById 핸들러 재사용 중) | ❌ 미구현 |
| 마진율 설정 | 구현됨 | ✅ |
| 정산일 설정 - **일/주/월 구분** | 현재 월 단위 날짜(Int)만 지원, 일/주/월 구분 없음 | ❌ 미구현 |
| 정산일 변경 시 현재까지 즉시 정산 처리 | 미구현 | ❌ |
| 충전소별 리베이트율 설정 | 구현됨 (`PATCH /:id/sites/:siteId/rebate`) | ✅ |
| 리베이트율 변경 후 새 트랜잭션부터 적용 | DB 즉시 업데이트 방식으로 동작 | ✅ |
| **은행 목록 API** (이름 + 로고) | 미구현 (현재 텍스트 직접 입력) | ❌ 미구현 |
| **계좌 유효성 검증** (1원 인증) | 미구현 | ❌ 미구현 |

### 1.2 DB 스키마 누락 필드

| 테이블 | 필요 필드 | 현재 상태 |
|--------|-----------|-----------|
| `partner_profile` | `settlementPeriodType` (daily/weekly/monthly) | 없음 → **마이그레이션 필요** |
| `partner_profile` | `settlementWeekday` (0~6, 주 단위 정산 요일) | 없음 → **마이그레이션 필요** |
| `bank_verification` | 계좌 1원 인증 임시 저장 테이블 | 없음 → **신규 테이블 필요** |

---

## 2. 실행 계획

### Phase 1: DB 스키마 확장 및 마이그레이션

#### Task 1-1: PartnerProfile 정산 주기 필드 추가
**수정 파일**: `prisma/schema.prisma`

추가 필드:
```prisma
model PartnerProfile {
  ...
  settlementPeriodType  SettlementCycle?   // 정산 주기 유형
  settlementWeekday     Int?  @db.SmallInt  // 0~6 (주 단위 정산 요일)
  // 기존 settlementDay: Int? 는 월 단위 날짜로 유지
  bankVerified          Boolean @default(false)  // 계좌 인증 완료 여부
}

enum SettlementCycle {
  daily    // 일 단위 (다음날 전일 정산)
  weekly   // 주 단위 (settlementWeekday 기준 요일)
  monthly  // 월 단위 (settlementDay 기준 날짜, 없는 날은 말일)
}
```

#### Task 1-2: BankVerification 테이블 추가
**수정 파일**: `prisma/schema.prisma`

```prisma
model BankVerification {
  id          Int      @id @default(autoincrement())
  partnerId   Int
  bankName    String   @db.VarChar(100)
  bankAccount String   @db.VarChar(50)
  holder      String   @db.VarChar(100)
  code        String   @db.VarChar(10)   // 인증코드 (4자리)
  expiresAt   DateTime                   // 5분 후 만료
  verified    Boolean  @default(false)
  createdAt   DateTime @default(now())

  @@map("bank_verification")
}
```

#### Task 1-3: 마이그레이션 실행
```bash
npx prisma migrate dev --name add_partner_settlement_cycle_bank_verify
```

---

### Phase 2: 백엔드 API 구현/보완

#### Task 2-1: 파트너 검색 필드 확장
**수정 파일**: `src/services/partner.service.ts`

현재 keyword 검색: username, email만 지원
변경 후: username **OR** businessName **OR** businessNo

```typescript
// 변경 전
where['user'] = { OR: [
  { username: { contains: keyword } },
  { email: { contains: keyword } },
] };

// 변경 후
where['OR'] = [
  { user: { username: { contains: keyword, mode: 'insensitive' } } },
  { businessName: { contains: keyword, mode: 'insensitive' } },
  { businessNo: { contains: keyword, mode: 'insensitive' } },
];
```

#### Task 2-2: 파트너 목록 응답 최적화
**수정 파일**: `src/services/partner.service.ts`

`list()` 메서드에서 `chargingSites: { include: { chargingStations: true } }` 제거
→ `_count: { select: { chargingSites: true } }` 로 교체

#### Task 2-3: 파트너 생성 API 실제 구현
**수정 파일**: `src/routes/portal/cs/partners.routes.ts`, `src/controllers/partner.controller.ts`, `src/services/partner.service.ts`

- `POST /api/portal/cs/partners` - CS가 직접 파트너 계정 생성
- 필드: username, password, email, businessName, businessNo, contactPhone
- User 생성(role=partner, status=pending) + PartnerProfile 생성

#### Task 2-4: 파트너 수정 API 실제 구현
**수정 파일**: 동일

- `PUT /api/portal/cs/partners/:id` - 파트너 기본정보 수정
- 필드: businessName, businessNo, contactPhone

#### Task 2-5: 정산 주기 설정 API 확장
**수정 파일**: `src/controllers/partner.controller.ts`, `src/services/partner.service.ts`

현재 `PATCH /:id/settlement-day` → 확장하거나 신규 endpoint 추가

```
PATCH /api/portal/cs/partners/:id/settlement-config
Body: {
  "period_type": "daily" | "weekly" | "monthly",
  "settlement_day": 15,      // monthly일 때 (1~28, 없는 날은 말일)
  "settlement_weekday": 5    // weekly일 때 (0=일~6=토)
}
```

**월말 처리 로직**: settlement_day가 해당 월에 없으면 말일로 대체
- 예: 31일 설정 시 4월은 30일, 2월은 28(29)일

#### Task 2-6: 은행 목록 API 추가
**신규**: `src/routes/portal/cs/partners.routes.ts` 또는 별도 라우터

```
GET /api/portal/banks
```

한국 주요 은행 목록(이름, 코드, 로고 경로)을 정적 데이터로 반환.
로고 이미지는 `public/assets/banks/` 에 저장.

지원 은행 목록:
- 국민은행, 신한은행, 우리은행, 하나은행, NH농협, IBK기업은행
- 카카오뱅크, 토스뱅크, 케이뱅크, 새마을금고, 신협 등

#### Task 2-7: 계좌 유효성 검증 API (Mock 구현)
**신규 파일**: 관련 컨트롤러/서비스

```
POST /api/portal/partner/bank-account/verify/init
Body: { bank_name, bank_account, bank_account_holder }
→ DB에 인증코드 저장, 5분 만료
→ [Mock] 실제 1원 송금 대신 코드 콘솔 출력 (추후 실제 은행 API로 교체)

POST /api/portal/partner/bank-account/verify/confirm
Body: { verification_id, code }
→ 코드 일치 + 5분 이내 → verified=true
→ 검증 완료 후 PartnerProfile bankVerified=true, 계좌정보 저장
```

**CS 포털도 동일 검증 적용** (CS가 파트너 계좌 수정 시):
```
POST /api/portal/cs/partners/:id/bank-account/verify/init
POST /api/portal/cs/partners/:id/bank-account/verify/confirm
```

---

### Phase 3: 프론트엔드 보완

#### Task 3-1: CS 포털 파트너 검색 placeholder 업데이트
**수정 파일**: `public/portal/cs/index.html`
- "사업자명, 아이디 검색..." → "아이디, 사업자명, 사업자번호 검색..."

#### Task 3-2: CS 포털 파트너 상세 - 정산 주기 UI 개선
**수정 파일**: `public/portal/cs/index.html`

현재: 숫자 입력 (매월 N일)
변경 후: 주기 유형 선택 + 유형별 세부 설정
```
[정산 주기] [일별▼] [주별▼] [월별▼]
  → 주별 선택 시: [요일 선택] 월/화/수/목/금/토/일
  → 월별 선택 시: [날짜 입력] 1~28 (없는 날은 말일 처리)
```

#### Task 3-3: CS 포털/파트너 포털 - 계좌 은행 선택 UI
**수정 파일**: `public/portal/cs/index.html`, `public/portal/partner/index.html`
- 텍스트 직접 입력 → 서버 은행 목록 API 호출 후 드롭다운 선택
- 로고 이미지 함께 표시

#### Task 3-4: 파트너 포털 계좌 인증 플로우 UI
**수정 파일**: `public/portal/partner/index.html`
- 계좌 입력 → "인증하기" 버튼 → 인증번호 입력 팝업 → 확인
- 5분 타이머 표시
- [Mock] "콘솔 확인" 안내 메시지 표시 (개발 단계)

---

### Phase 4: 설계 가이드 문서화

#### Task 4-1: 파트너 관리 설계 가이드 작성
**신규 파일**: `documents/design_guide/14_partner_management.md`

---

## 3. 수정/신규 파일 목록

| 파일 | 작업 | Phase |
|------|------|-------|
| `prisma/schema.prisma` | settlementPeriodType, settlementWeekday, BankVerification 추가 | 1 |
| `prisma/migrations/` | 마이그레이션 파일 생성 | 1 |
| `src/services/partner.service.ts` | 검색 확장, 목록 최적화, 생성/수정, 정산주기 확장 | 2 |
| `src/controllers/partner.controller.ts` | 생성/수정/정산주기 핸들러 추가 | 2 |
| `src/routes/portal/cs/partners.routes.ts` | stub 제거, 신규 endpoint 등록 | 2 |
| `src/routes/portal/partner/bankAccount.routes.ts` | 계좌 인증 endpoint 추가 | 2 |
| `public/assets/banks/` | 은행 로고 이미지 (SVG) | 2 |
| `public/portal/cs/index.html` | 검색 placeholder, 정산주기 UI, 은행 드롭다운 | 3 |
| `public/portal/partner/index.html` | 은행 드롭다운, 계좌 인증 플로우 UI | 3 |
| `documents/design_guide/14_partner_management.md` | 신규 설계 가이드 | 4 |

---

## 4. 우선순위

| 우선순위 | 항목 | 이유 |
|----------|------|------|
| **P0** | 파트너 생성/수정 stub 제거 → 실제 구현 | 현재 CS가 파트너를 만들 수 없음 |
| **P0** | 파트너 검색 필드 확장 (사업자명/번호) | 핵심 운영 기능 누락 |
| **P1** | 정산 주기 설정 확장 (일/주/월) + DB 마이그레이션 | 정산 자동화 기반 |
| **P1** | 은행 목록 API + UI 드롭다운 | 계좌 입력 UX 개선 |
| **P2** | 계좌 유효성 검증 (1원 인증 Mock) | 실제 은행 API 없으므로 Mock 구현 |
| **P2** | 목록 응답 최적화 | 성능 개선 |
| **P3** | 설계 가이드 문서화 | 유지보수 참조 |

---

## 5. 주요 설계 결정 사항

### 5.1 정산 주기 말일 처리
```typescript
// settlement_day=31인 경우 4월(30일) → 30일, 2월(28일) → 28일
function resolveSettlementDate(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month, 0).getDate(); // 해당 월 마지막 날
  return new Date(year, month - 1, Math.min(day, lastDay));
}
```

### 5.2 계좌 인증 Mock 전략
- 실제 은행 API(오픈뱅킹) 연동 전까지 Mock 모드로 동작
- Mock 모드: 인증코드를 서버 로그에 출력, 어떤 코드든 5분 이내 입력 시 통과
- 환경변수 `BANK_VERIFY_MOCK=true` 로 제어

### 5.3 리베이트율 적용 계산
- 파트너 상세 충전이력 탭의 "금액" 컬럼:
  - `파트너 수익 = costKrw × (rebateRate / 100)`
  - 단, rebateRate는 해당 충전소의 rebateRate 기준

---

## 6. 테스트 시나리오

| 시나리오 | 예상 결과 |
|----------|-----------|
| CS가 "국민" 키워드로 파트너 검색 | businessName에 "국민" 포함된 파트너 반환 |
| CS가 사업자번호로 파트너 검색 | businessNo 부분 매칭 결과 반환 |
| CS가 새 파트너 등록 | User(role=partner, status=pending) + PartnerProfile 생성 |
| CS가 정산주기를 weekly + 금요일로 설정 | settlementPeriodType=weekly, settlementWeekday=5 저장 |
| CS가 정산일을 31일(monthly)로 설정 후 4월 정산 | 4월 30일로 처리 |
| 파트너가 계좌 인증 시도 (Mock) | 서버 로그에 코드 출력, 입력 시 verified=true |
| CS 포털 계좌 입력 시 은행 드롭다운 | 은행 목록 + 로고 표시 |
