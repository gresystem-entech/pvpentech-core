# 11. 포탈 메뉴 구조 설계 가이드

- **버전**: v1.0
- **작성일**: 2026-03-31
- **대상**: 프론트엔드 개발자, 백엔드 개발자
- **참조**: `design_ref/usage_scenario.txt`, `design_ref/06_portal_implementation_plan.md`, `design_ref/Portal_detail.txt`

---

## 1. 개요 (Overview)

Pvpentech 포탈은 3개 역할에 따라 완전히 분리된 메뉴 구조를 제공합니다.

| 역할 | 코드 | 가입 방식 | 포탈 접근 URL |
|------|------|-----------|--------------|
| 고객센터 | `cs` | 관리자 DB 직접 승인 | `/portal/cs/` |
| 파트너 | `partner` | 고객센터 승인 후 Active | `/portal/partner/` |
| 고객 | `customer` | 가입 즉시 Active | `/portal/customer/` |

### 권한 원칙

- 파트너는 고객센터 메뉴 중 **본인 소속 데이터**만 열람 가능
- 고객은 고객센터 메뉴 중 **본인 관련 데이터**만 열람 가능
- 고객센터는 전체 데이터에 접근 가능

---

## 2. 고객센터(CS) 포탈 메뉴 구조

### 2.1 메뉴 트리

```
고객센터 포탈 (/portal/cs/)
│
├── 대시보드 (dashboard)
│   ├── KPI 카드 영역
│   │   ├── 전체 충전기 수 (온라인 / 오프라인 / 장애)
│   │   ├── 전체 고객 수 / 파트너 수
│   │   ├── 누적 충전건수 / 누적 충전량(kWh)
│   │   └── 누적 장애건수 / 미처리 장애건수
│   └── 서비스 현황 탭
│       ├── 일별 현황 (지난 4일, 기본)
│       ├── 주별 현황 (지난 4주)
│       └── 월별 현황 (지난 4달)
│           └── [상세내역] → 충전소별/충전기별 통계
│
├── 파트너 관리 (partners)
│   ├── 파트너 목록 (승인대기 포함, 필터/검색)
│   ├── 파트너 추가
│   └── 파트너 상세
│       ├── 기본정보 수정
│       ├── 마진율(%) 설정
│       ├── 정산일자 설정
│       ├── 소속 충전소 목록 (충전량/충전금액/정산금액)
│       ├── 정산 송금 실행
│       ├── 비활성화
│       └── 삭제
│
├── 충전소 관리 (sites)
│   ├── 충전소 목록
│   ├── 충전소 등록 (충전소명/관리파트너/주소/충전사업자/관리자)
│   ├── 충전소 상세/수정
│   └── 충전소 삭제
│
├── 충전기 관리 (stations)
│   ├── 충전기 목록 (상태/키워드 필터)
│   ├── 충전기 등록 (충전소/충전기ID/제조사/시리얼/펌웨어)
│   ├── 충전기 상세
│   │   ├── 기본정보 수정
│   │   ├── 충전이력
│   │   └── 장애이력 (등록/조회)
│   └── 충전기 삭제
│
├── 사용자 관리 (users)
│   ├── 사용자 목록 (역할/상태/키워드 필터)
│   ├── 사용자 추가
│   ├── 사용자 상세
│   │   ├── 기본정보 수정
│   │   ├── 활성/비활성 토글
│   │   └── 결제카드 목록/등록/삭제
│   └── 사용자 삭제
│
├── 충전카드 관리 (id-tokens)
│   ├── 카드 목록 (이용중 여부 표시)
│   └── 카드별 상세 (인증상태, 연결 고객 정보)
│
├── 정산 관리 (settlements)
│   ├── 정산 현황 탭
│   │   ├── 일별 정산 내역
│   │   ├── 주별 정산 내역
│   │   └── 월별 정산 내역
│   ├── 사용자별 정산내역
│   ├── 파트너별 정산내역
│   ├── 충전소별 정산내역
│   ├── 기기별 정산내역
│   └── 즉시 정산 (송금이체)
│
└── 충전기 운영 (operations)
    ├── 운영변수 설정 (Online 충전기 목록 + 변수 설정)
    │   ├── 충전기별 운영변수
    │   ├── 충전소별 운영변수
    │   └── 주소별 운영변수
    ├── 원격지원 (펌웨어 다운로드 등 OCPP 명령 전송)
    └── 메시지 로그 (시간/충전기ID/메시지타입 검색)
```

### 2.2 메뉴 항목 상세 명세

| 메뉴 | 한국어 메뉴명 | i18n 키 | 접근 Role | 경로 |
|------|-------------|---------|-----------|------|
| 대시보드 | 대시보드 | `menu.dashboard` | cs | `/portal/cs/` |
| 파트너 관리 | 파트너 관리 | `menu.partners` | cs | `/portal/cs/partners` |
| 충전소 관리 | 충전소 관리 | `menu.sites` | cs | `/portal/cs/sites` |
| 충전기 관리 | 충전기 관리 | `menu.stations` | cs | `/portal/cs/stations` |
| 사용자 관리 | 사용자 관리 | `menu.users` | cs | `/portal/cs/users` |
| 충전카드 관리 | 충전카드 관리 | `menu.idTokens` | cs | `/portal/cs/id-tokens` |
| 정산 관리 | 정산 관리 | `menu.settlements` | cs | `/portal/cs/settlements` |
| 운영 > 운영변수 설정 | 운영변수 설정 | `menu.ops.variables` | cs | `/portal/cs/ops/variables` |
| 운영 > 원격지원 | 원격지원 | `menu.ops.remote` | cs | `/portal/cs/ops/remote` |
| 운영 > 메시지 로그 | 메시지 로그 | `menu.ops.msglog` | cs | `/portal/cs/ops/msglog` |

---

## 3. 파트너 포탈 메뉴 구조

### 3.1 메뉴 트리

```
파트너 포탈 (/portal/partner/)
│
├── 대시보드 (dashboard)
│   └── 내 충전소 현황 요약 (충전기 수/온라인 수/당월 충전량/금액)
│
├── 내 충전소 (sites)
│   ├── 소속 충전소 목록
│   ├── 충전소 상세 (읽기전용)
│   │   └── 해당 충전소 충전기 목록
│   └── 충전단가(unit_price) 수정
│
├── 내 충전기 (stations)
│   ├── 소속 충전기 상태 목록 (30초 폴링)
│   └── 충전기 상세 (읽기전용)
│       ├── 충전이력
│       └── 장애이력 (조회만)
│
├── 통계 (stats)
│   ├── 당월 통계 (충전량/충전금액/충전건수)
│   └── 전월 통계 비교
│
├── 정산 내역 (settlements)
│   ├── 내 정산 이력 (파트너 본인 소속)
│   └── 충전소별 정산 내역
│
└── 계좌정보 (bank-account)
    ├── 계좌정보 조회
    └── 계좌정보 등록/수정 (정산금 수령용)
```

### 3.2 메뉴 항목 상세 명세

| 메뉴 | 한국어 메뉴명 | i18n 키 | 접근 Role | 경로 |
|------|-------------|---------|-----------|------|
| 대시보드 | 대시보드 | `menu.dashboard` | partner | `/portal/partner/` |
| 내 충전소 | 내 충전소 | `menu.mySites` | partner | `/portal/partner/sites` |
| 내 충전기 | 내 충전기 | `menu.myStations` | partner | `/portal/partner/stations` |
| 통계 | 충전 통계 | `menu.stats` | partner | `/portal/partner/stats` |
| 정산 내역 | 정산 내역 | `menu.settlements` | partner | `/portal/partner/settlements` |
| 계좌정보 | 계좌정보 | `menu.bankAccount` | partner | `/portal/partner/bank-account` |

---

## 4. 고객 포탈 메뉴 구조

### 4.1 메뉴 트리

```
고객 포탈 (/portal/customer/)
│
├── 대시보드 (dashboard)
│   └── 내 충전 요약 (이번달 충전건수/충전량/충전금액)
│
├── 충전이력 (history)
│   ├── 내 충전이력 목록 (페이지네이션)
│   └── 충전이력 상세
│
├── 결제카드 (payment-cards)
│   ├── 결제카드 목록
│   ├── 결제카드 등록 (후불결제용)
│   └── 결제카드 삭제
│
├── 충전카드(RFID) (rfid-cards)
│   ├── RFID 카드 목록
│   ├── RFID 카드 등록
│   └── RFID 카드 삭제
│
└── 내 프로필 (profile)
    └── 프로필 조회/수정 (이름/연락처/이메일)
```

### 4.2 메뉴 항목 상세 명세

| 메뉴 | 한국어 메뉴명 | i18n 키 | 접근 Role | 경로 |
|------|-------------|---------|-----------|------|
| 대시보드 | 대시보드 | `menu.dashboard` | customer | `/portal/customer/` |
| 충전이력 | 충전이력 | `menu.history` | customer | `/portal/customer/history` |
| 결제카드 | 결제카드 관리 | `menu.paymentCards` | customer | `/portal/customer/payment-cards` |
| 충전카드 | 충전카드(RFID) | `menu.rfidCards` | customer | `/portal/customer/rfid-cards` |
| 내 프로필 | 내 프로필 | `menu.profile` | customer | `/portal/customer/profile` |

---

## 5. 역할별 접근 권한 매핑 (Role Guard)

### 5.1 Role Guard 원칙

```typescript
// 접근 허용 매핑
const menuRoleGuard: Record<string, UserRole[]> = {
  // CS 전용 메뉴
  '/portal/cs/*':            ['cs'],

  // 파트너 전용 메뉴
  '/portal/partner/*':       ['partner'],

  // 고객 전용 메뉴
  '/portal/customer/*':      ['customer'],
};
```

### 5.2 CS/파트너/고객 비교 — 같은 데이터에 대한 접근 범위

| 데이터 | CS | 파트너 | 고객 |
|--------|-----|--------|------|
| 충전소 | 전체 CRUD | 본인 소속 읽기 + 단가수정 | 없음 |
| 충전기 | 전체 CRUD | 본인 소속 읽기 | 없음 |
| 충전이력 | 전체 조회 | 본인 소속 충전소 조회 | 본인 이력만 조회 |
| 파트너 정보 | 전체 CRUD + 승인 | 본인 정보만 읽기/수정 | 없음 |
| 사용자 정보 | 전체 CRUD | 없음 | 본인만 읽기/수정 |
| 결제카드 | 전체 조회/관리 | 없음 | 본인만 CRUD |
| 충전카드(RFID) | 전체 조회 | 없음 | 본인만 CRUD |
| 정산 내역 | 전체 조회 + 즉시정산 | 본인 소속 조회 | 없음 |
| 계좌정보 | 전체 조회 | 본인 등록/수정 | 없음 |
| OCPP 메시지 로그 | 전체 조회 | 없음 | 없음 |
| 운영변수 | 읽기/수정 | 없음 | 없음 |
| 원격지원 명령 | 실행 가능 | 없음 | 없음 |

---

## 6. 주요 화면별 핵심 기능 설명

### 6.1 CS 대시보드

**KPI 카드 (상단 요약)**
- 충전기 현황: 전체 / 온라인(`StationStatus.Online`) / 오프라인(`StationStatus.Offline`) / 장애(`StationStatus.Faulted`) 수
- 사용자 현황: 전체 고객 수 / 전체 파트너 수
- 충전 현황: 누적 충전건수 / 누적 충전량(kWh)
- 장애 현황: 누적 장애건수 / 미처리 장애건수 (`resolvedAt IS NULL`)

**서비스 현황 탭 (목록 형태)**
- 일별: 최근 4일 — 충전량(kWh) / 전일대비 증감 / 충전금액(원) / 전일대비 증감 / 충전횟수 / 증감 / [상세내역 링크]
- 주별: 최근 4주 동일 구성
- 월별: 최근 4달 동일 구성
- [상세내역]: 해당 기간 충전소별/충전기별 동일 지표 + 증감

### 6.2 파트너 관리 상세 화면 (CS 전용)

- 파트너 기본정보: 사업체명, 사업자번호, 담당자 연락처
- **마진율(%) 설정**: 충전금액 × marginRate = 파트너 정산금액
- **정산일자 설정**: 매월 N일 (1~28)
- **소속 충전소 현황**: 충전소명 / 충전량(kWh) / 충전금액(원) / 정산금액(원)
- **즉시 정산 버튼**: 선택 기간 미정산 금액 송금이체 실행 → `Settlement` 레코드 생성

### 6.3 충전소 등록 화면 (CS 전용)

| 필드 | 설명 |
|------|------|
| 충전소명 | siteName (필수) |
| 관리 파트너 | partnerId FK (필수) |
| 주소 | address (필수) |
| 충전사업자 | chargeOperatorName (필수) |
| 관리자 이름 | managerName |
| 관리자 전화번호 | managerPhone |
| 충전단가 | unitPrice (원/kWh, 기본 250) |

### 6.4 충전기 등록 화면 (CS 전용)

| 필드 | 설명 |
|------|------|
| 충전소 선택 | siteId FK (필수) |
| 충전기 아이디 | `"EN" + 7자리 숫자` 형식 (필수) |
| 제조사 | vendorName |
| 시리얼번호 | serialNumber |
| 펌웨어버전 | firmwareVersion |

### 6.5 충전카드 관리 화면 (CS 전용)

- 카드 목록: idTag / 연결 고객 / 카드 상태(`IdTokenStatus`) / **현재 이용중 여부**
- 이용중 여부 판단 기준: `IdToken.status = Accepted` AND `Transaction.status IN (Pending, Active)`
- 고객 Inactive 시 → 해당 고객의 모든 `IdToken.status = Blocked`로 자동 변경

### 6.6 정산 관리 화면 (CS 전용)

- **정산 현황**: 기간별 탭 (일별/주별/월별) — 충전량/충전금액/결제금액/미결제금액
- **사용자별 정산내역**: 사용자 검색 후 해당 사용자 트랜잭션 정산 내역
- **파트너별 정산내역**: 파트너별 정산금액(충전금액 × 마진율) 합산
- **충전소별/기기별 정산내역**: 소속 기준 집계
- **즉시 정산 버튼**: 파트너별로 미정산 금액 선택 후 송금이체 실행

### 6.7 충전기 운영 — 운영변수 설정

- Online 충전기 목록 표시 (ConnectionManager 상태 기준)
- 충전기별 DeviceVariable 조회/수정 (OCPP ChangeConfiguration 명령 전송)
- 충전소 단위 일괄 적용 가능

### 6.8 충전기 운영 — 원격지원

- UpdateFirmware: 펌웨어 다운로드 URL + 실행 시각 설정 후 OCPP 명령 전송
- GetDiagnostics: 진단 로그 요청
- Reset: Hard/Soft 재시작

### 6.9 파트너 계좌정보 등록

- 파트너가 직접 등록: 은행명, 계좌번호, 예금주
- CS도 조회 가능 (수정은 파트너 본인만)

### 6.10 고객 결제카드 등록

- 후불 결제용 신용/체크카드 정보 등록
- 카드 끝 4자리 마스킹 표시
- PG 빌링키 연동 준비 (현재는 카드 정보 저장만)

---

## 7. 포탈 라우트 구조 (API 기준)

### 7.1 URL 패턴 원칙

```
/api/portal/{role}/{resource}[/{id}][/{action}]

예시:
/api/portal/cs/partners                        → CS 파트너 목록
/api/portal/cs/partners/:id/settle             → 즉시 정산 실행
/api/portal/partner/settlements                → 파트너 본인 정산 내역
/api/portal/customer/payment-cards             → 고객 결제카드 목록
```

### 7.2 역할별 라우트 파일 구성

```
src/routes/
├── portal/
│   ├── cs/
│   │   ├── dashboard.routes.ts
│   │   ├── partners.routes.ts       ← 마진/정산/계좌 포함
│   │   ├── sites.routes.ts
│   │   ├── stations.routes.ts
│   │   ├── users.routes.ts
│   │   ├── idTokens.routes.ts
│   │   ├── settlements.routes.ts    ← 신규
│   │   └── ops.routes.ts            ← variables + remote + msglog
│   ├── partner/
│   │   ├── dashboard.routes.ts
│   │   ├── sites.routes.ts
│   │   ├── stations.routes.ts
│   │   ├── stats.routes.ts
│   │   ├── settlements.routes.ts    ← 신규
│   │   └── bankAccount.routes.ts    ← 신규
│   └── customer/
│       ├── dashboard.routes.ts
│       ├── history.routes.ts
│       ├── paymentCards.routes.ts   ← 신규 (결제카드)
│       ├── rfidCards.routes.ts
│       └── profile.routes.ts
```

---

## 8. i18n 키 목록 (포탈 메뉴 전용)

```json
// locales/ko/portal.json
{
  "menu": {
    "dashboard": "대시보드",
    "partners": "파트너 관리",
    "sites": "충전소 관리",
    "stations": "충전기 관리",
    "users": "사용자 관리",
    "idTokens": "충전카드 관리",
    "settlements": "정산 관리",
    "ops": {
      "root": "충전기 운영",
      "variables": "운영변수 설정",
      "remote": "원격지원",
      "msglog": "메시지 로그"
    },
    "mySites": "내 충전소",
    "myStations": "내 충전기",
    "stats": "충전 통계",
    "bankAccount": "계좌정보",
    "history": "충전이력",
    "paymentCards": "결제카드 관리",
    "rfidCards": "충전카드(RFID)",
    "profile": "내 프로필"
  }
}
```

---

## 9. 체크리스트

- [ ] 역할별 포탈 라우터 파일 구성 완료
- [ ] Role Guard 미들웨어 각 라우트에 적용 (`requireRole` 미들웨어)
- [ ] CS 대시보드 KPI API 구현 (충전기 수, 장애 수, 누적 통계)
- [ ] CS 대시보드 서비스 현황 탭 API 구현 (일별/주별/월별 + 증감)
- [ ] 파트너 마진율/정산일자 수정 API 구현
- [ ] 즉시 정산(송금이체) API 구현 + Settlement 레코드 생성
- [ ] 충전소 등록 시 충전사업자/관리자 필드 포함
- [ ] 충전기 등록 시 "EN" + 7자리 ID 형식 검증
- [ ] 충전카드 이용중 여부 실시간 표시 API 구현
- [ ] 고객 Inactive 시 IdToken 자동 Blocked 처리 로직 구현
- [ ] 파트너 계좌정보 등록/수정 API 구현
- [ ] 고객 결제카드 등록/삭제 API 구현
- [ ] 정산 관리 API (사용자별/파트너별/충전소별/기기별) 구현
- [ ] i18n 키 portal.json 번역 파일 (ko/en/vi) 생성

---

## 10. 로그인 페이지 요구사항 (신규)

### 10.1 다국어 선택
- 페이지 상단 우측 또는 카드 내부에 언어 선택 버튼 배치
- 기본 언어: **영어(en)**
- 선택 가능 언어: 한국어(ko), 베트남어(vi)
- 언어 선택 시 localStorage('cp_lang')에 저장, 즉시 UI 언어 전환
- 모든 레이블, 버튼, 에러 메시지가 선택된 언어로 표시

### 10.2 회원가입
- 로그인 카드 하단에 "회원가입" 링크 버튼 배치
- 클릭 시 회원 유형 선택 화면: **고객 가입 / 파트너 가입** 두 옵션
- 고객 가입 폼 필드: 아이디(username), 이메일, 비밀번호, 비밀번호 확인, 전화번호
- 파트너 가입 폼 필드: 아이디, 이메일, 비밀번호, 비밀번호 확인, 전화번호, 사업체명, 사업자번호, 담당자 연락처
- 가입 완료 후 "가입이 완료되었습니다" 메시지 표시 후 로그인 화면으로 복귀
- 파트너 가입은 CS 승인 후 로그인 가능함을 안내 메시지로 표시

### 10.3 로그인 후 역할 기반 리디렉션
- CS(cs) → /portal/cs/
- 파트너(partner) → /portal/partner/
- 고객(customer) → /portal/customer/

## 11. 고객·파트너 포털 구조 원칙 (신규)

CS 포털을 기준으로, 각 역할에 허용된 메뉴와 데이터만 표시합니다.
동일한 SPA 패턴(navigate, loadListPage, PAGE_CONFIGS)을 사용하여 일관성을 유지합니다.

### 11.1 고객 포털 허용 메뉴
| 메뉴 | API | 설명 |
|------|-----|------|
| 대시보드 | GET /api/portal/customer/dashboard | 본인 충전 요약 |
| 충전이력 | GET /api/portal/customer/history | 본인 충전이력 |
| 결제카드 | GET /api/portal/customer/payment-cards | 본인 결제카드 CRUD |
| 충전카드(RFID) | GET /api/portal/customer/rfid-cards | 본인 RFID 카드 CRUD |
| 내 프로필 | GET /api/portal/customer/profile | 본인 정보 수정 |

### 11.2 파트너 포털 허용 메뉴
| 메뉴 | API | 설명 |
|------|-----|------|
| 대시보드 | GET /api/portal/partner/dashboard | 내 충전소 현황 요약 |
| 내 충전소 | GET /api/portal/partner/sites | 소속 충전소 목록 + 단가수정 |
| 내 충전기 | GET /api/portal/partner/stations | 소속 충전기 상태 (30초 폴링) |
| 충전 통계 | GET /api/portal/partner/stats | 당월/전월 통계 비교 |
| 정산 내역 | GET /api/portal/partner/settlements | 본인 소속 정산 이력 |
| 계좌정보 | GET /api/portal/partner/bank-account | 정산금 수령 계좌 등록/수정 |
