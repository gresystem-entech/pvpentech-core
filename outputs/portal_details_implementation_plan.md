# 포털 상세 기능 구현 계획

- **작성일**: 2026-04-16
- **참조**: `documents/design_ref/portal_details.md`
- **대상**: Partner Portal, Customer Portal
- **상태**: Gap 분석 완료, 구현 대기

---

## 1. Gap 분석 요약

### 1.1 Partner Portal

| 메뉴 | 요건 | 현재 구현 | 상태 |
|------|------|-----------|------|
| 대시보드 | 내 충전기 수, 온라인 충전기, 당월충전량, 당월충전금액 | 4개 KPI 카드 출력 | ✅ |
| 내 충전소 | 충전소 목록 (이름/주소/충전기수/단가) | 목록 + 단가 수정 모달 | ✅ |
| 내 충전소 | **충전단가 변경이력 조회** | 미구현 | ❌ |
| 내 충전기 | 충전기id/충전소명/상태/마지막연결 | 30초 자동갱신 구현 | ✅ |
| 충전 통계 | 충전건수/충전량/충전금액 트렌드 | 이번달/전달 비교만 있음, **기간 선택 없음** | ⚠️ |
| 정산 내역 | 정산일/충전소명/충전량/충전금액/정산금액/상태 | 목록 출력 | ✅ |
| 정산 내역 | **조회기간 필터** (preset: 1주/1달/3달/6달/1년 + 직접입력) | 미구현 | ❌ |
| 정산 내역 | **엑셀 다운로드** | 미구현 | ❌ |
| 계좌정보 | 은행명/계좌번호/예금주 등록·변경 | 구현됨 | ✅ |
| 계좌정보 | **유효성 검증** (필수항목 이상의 포맷 검증) | 필수입력 체크만 | ⚠️ |

### 1.2 Customer Portal

| 메뉴 | 요건 | 현재 구현 | 상태 |
|------|------|-----------|------|
| 대시보드 | **조회기간 preset** (1일/1주/1달/3달/6달/1년/전체) | 기간 필터 없음 (전체 합계만) | ❌ |
| 대시보드 | 총충전건수/충전량/충전금액, RFID카드수, 최근이력 5건 | KPI + 최근이력 출력 | ✅ |
| 충전이력 | **조회기간 preset + 직접입력** | 페이지네이션만 (기간 필터 없음) | ❌ |
| 충전이력 | 충전일시/충전소명/충전량/충전금액/상태 | 출력됨 | ✅ |
| 결제카드 | 카드 등록 (카드번호/유효기간/소유자) | 구현됨 | ✅ |
| 결제카드 | **계좌 등록** (은행명/계좌번호/계좌소유자) | 미구현 (카드만 가능) | ❌ |
| 결제카드 | 카드 목록 조회 (카드사/카드번호/등록일) | 구현됨 | ✅ |
| 결제카드 | **마지막 카드 삭제 방지** (1개 남으면 삭제 불가) | 미구현 (삭제 제한 없음) | ❌ |

---

## 2. 구현 항목 상세

### [P1] Partner Portal — 충전단가 변경이력

**위치**: 내 충전소 화면, 각 충전소 행에 "이력" 버튼 추가  
**API**: 기존 `GET /api/portal/partner/sites/:id` 또는 별도 이력 엔드포인트

**프론트엔드 변경 (`public/portal/partner/index.html`)**:
```
내 충전소 목록 테이블
├── 충전소명 | 주소 | 충전기수 | 충전단가 | [단가수정] [이력]  ← "이력" 버튼 추가
```

단가 변경이력 모달:
```
충전소명: OO충전소  
변경이력
┌─────────────────────────────────────────────┐
│ 변경일시         │ 이전단가  │ 변경단가 │ 변경자 │
│ 2026-04-01 10:00 │ 250원/kWh │ 280원/kWh│ admin  │
│ 2026-03-15 15:30 │ 230원/kWh │ 250원/kWh│ admin  │
└─────────────────────────────────────────────┘
```

**백엔드**:
- DB 스키마: `charging_site` 테이블에 단가 변경시 이력 저장 테이블 필요  
  → `site_price_history` 테이블 추가 마이그레이션 필요  
  → 또는 기존 `PATCH /:id/price` 호출 시 이전 값을 로그로 남기는 방식

**API 신규**:
```
GET /api/portal/partner/sites/:id/price-history
Response: { items: [{ changedAt, previousPrice, newPrice, changedBy }] }
```

---

### [P2] Partner Portal — 정산 내역 조회기간 필터

**위치**: 정산 내역 상단 필터 바  
**프론트엔드 변경**:
```
[1주일] [1달] [3달] [6달] [1년]  시작일: [____] 종료일: [____]  [조회]
```

- preset 버튼 클릭 시 자동으로 dateFrom/dateTo 계산 후 조회
- `loadSettlements(page, dateFrom, dateTo)` 함수 signature 변경

**API 변경**:
```
GET /api/portal/partner/settlements?page=1&limit=20&dateFrom=2026-01-01&dateTo=2026-04-16
```

기존 API에 `dateFrom`, `dateTo` 쿼리파라미터 추가 처리 필요  
→ `src/routes/portal/partner/settlements.routes.ts` + 서비스 레이어 수정

---

### [P3] Partner Portal — 정산 내역 엑셀 다운로드

**위치**: 정산 내역 페이지 헤더에 "엑셀 다운로드" 버튼  
**방식**: 서버에서 xlsx 생성 후 파일 스트림 반환 (또는 프론트에서 CSV 생성)

**옵션 A (서버 생성, 권장)**:
```
GET /api/portal/partner/settlements/export?dateFrom=...&dateTo=...
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="settlements_2026-04.xlsx"
```
- `xlsx` npm 패키지 사용
- 컬럼: 정산일, 충전소명, 충전량(kWh), 충전금액(원), 정산금액(원), 상태

**옵션 B (클라이언트 CSV)**:
- 조회된 테이블 데이터를 CSV 변환 후 Blob 다운로드
- 라이브러리 추가 불필요, 구현 간단

→ **옵션 B로 우선 구현** (서버 변경 최소화)

```javascript
function downloadSettlementsCsv(items) {
  const header = ['정산일', '충전소명', '충전량(kWh)', '충전금액(원)', '정산금액(원)', '상태'];
  const rows = items.map(r => [...]);
  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  // BOM(\uFEFF) 추가로 한글 깨짐 방지
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'settlements.csv';
  a.click(); URL.revokeObjectURL(url);
}
```

---

### [P4] Partner Portal — 충전 통계 기간 선택

**현재**: 이번달 vs 전달 2패널 비교  
**요건**: "트렌드" 확인 → 기간 선택 후 충전건수/충전량/충전금액 추이 시각화

**프론트엔드 변경**:
```
기간: [1달] [3달] [6달] [1년]
────────────────────────────────────────
월별 집계 테이블:
│ 월    │ 충전건수 │ 충전량(kWh) │ 충전금액(원) │
│ 03월  │ 245      │ 1,234.56    │ 308,640      │
│ 04월  │ 312      │ 1,567.89    │ 391,973      │
```

차트 라이브러리 도입 여부는 별도 결정. 우선 테이블 형태로 구현 후 필요 시 Chart.js 추가.

**API 변경**:
```
GET /api/portal/partner/stats?period=monthly&months=6
Response: { items: [{ month:"2026-03", count, totalKwh, totalAmount }, ...] }
```

---

### [C1] Customer Portal — 대시보드/충전이력 조회기간 필터

**위치**: 대시보드 상단 + 충전이력 상단에 동일한 필터 컴포넌트

**UI 구조**:
```
[1일] [1주일] [1달] [3달] [6달] [1년] [전체]
시작일: [__________]  종료일: [__________]
```

- 버튼 선택 시 dateFrom/dateTo 자동 계산
- "전체" 선택 시 dateFrom/dateTo 비워서 전체 기간 조회

**대시보드**: 선택 기간에 맞게 KPI 재조회
```
GET /api/portal/customer/dashboard?dateFrom=2026-01-01&dateTo=2026-04-16
```

**충전이력**: 기간 필터 + 기존 페이지네이션 병행
```
GET /api/portal/customer/history?page=1&limit=20&dateFrom=2026-01-01&dateTo=2026-04-16
```

**백엔드**:
- `src/routes/portal/customer/dashboard.routes.ts` — dateFrom/dateTo 쿼리 처리
- `src/routes/portal/customer/history.routes.ts` — 기존 또는 dateFrom/dateTo 추가

---

### [C2] Customer Portal — 결제카드 계좌등록

**현재**: 카드등록만 가능 (카드번호/유효기간/카드소유자)  
**추가**: 계좌등록 탭 추가 (은행명/계좌번호/계좌소유자)

**UI**: 카드등록 모달에 탭 추가
```
결제수단 추가
[카드 등록] [계좌 등록]   ← 탭 전환

[카드 등록 탭]
  카드번호: [________________]
  유효기간: [MM/YY]
  소유자:   [________________]

[계좌 등록 탭]
  은행명:   [________________]
  계좌번호: [________________]
  소유자:   [________________]
```

**DB/API**:
- `payment_card` 테이블에 `type` 컬럼 추가 (`card` / `bank`) 또는 별도 테이블  
- 현재 테이블 구조(`cardLast4`, `cardType`, `billingKey`) 기준으로 계좌는  
  `cardLast4` → 계좌번호 뒷 4자리, `cardType` → 은행명으로 저장 가능  
  → 스키마 변경 최소화 방향 검토 필요

**API**: 기존 `POST /api/portal/customer/payment-cards`에 `type` 필드 추가
```json
{ "type": "bank", "bankName": "국민은행", "accountNumber": "1234-56-789012", "accountHolder": "홍길동" }
```

---

### [C3] Customer Portal — 마지막 결제카드 삭제 방지

**현재**: `deletePaymentCard(id)` → 바로 DELETE 호출  
**수정**: 삭제 전 현재 카드 수 확인, 1개 남아있으면 삭제 불가 알림

```javascript
async function deletePaymentCard(id) {
  if (!confirm(t('confirmDeleteCard'))) return;
  
  // 현재 카드 수 확인
  const listData = await api('/api/portal/customer/payment-cards');
  const cards = listData?.data?.items || listData?.data || [];
  if (cards.length <= 1) {
    alert(t('errorLastCard'));  // "마지막 결제카드는 삭제할 수 없습니다."
    return;
  }
  
  const data = await api(`/api/portal/customer/payment-cards/${id}`, { method: 'DELETE' });
  if (data && data.success) { loadPaymentCards(); }
  else { alert((data && data.error && data.error.message) || 'Delete failed.'); }
}
```

또는 서버 레벨에서 카드 1개 남으면 409 반환하도록 처리 (더 안전).

---

## 3. 구현 우선순위 및 분류

### 높음 — 핵심 기능 누락

| ID | 항목 | 포털 | 예상 작업량 |
|----|------|------|------------|
| C1 | 충전이력 조회기간 필터 (preset + 직접입력) | Customer | 중 |
| C3 | 마지막 결제카드 삭제 방지 | Customer | 소 |
| P2 | 정산 내역 조회기간 필터 | Partner | 중 |

### 중간 — 편의 기능

| ID | 항목 | 포털 | 예상 작업량 |
|----|------|------|------------|
| C1 | 대시보드 조회기간 preset | Customer | 중 |
| P1 | 충전단가 변경이력 조회 | Partner | 중 (백엔드 포함) |
| P3 | 정산 내역 CSV 다운로드 | Partner | 소 |
| C2 | 결제카드 계좌등록 | Customer | 중 (스키마 검토 필요) |

### 낮음 — 후순위

| ID | 항목 | 포털 | 예상 작업량 |
|----|------|------|------------|
| P4 | 충전 통계 기간 선택 + 추이 | Partner | 중 |
| P_계좌 | 계좌정보 포맷 유효성 검증 | Partner | 소 |

---

## 4. 백엔드 API 변경이 필요한 항목

| 항목 | API 변경 내용 |
|------|---------------|
| P1 충전단가 이력 | `GET /partner/sites/:id/price-history` 신규 (DB 이력 테이블 필요) |
| P2 정산기간 필터 | `GET /partner/settlements` — `dateFrom`, `dateTo` 쿼리파라미터 추가 |
| P4 통계 트렌드 | `GET /partner/stats` — `period=monthly&months=N` 파라미터 추가 |
| C1 이력 기간 필터 | `GET /customer/history` — `dateFrom`, `dateTo` 파라미터 추가 |
| C1 대시보드 기간 | `GET /customer/dashboard` — `dateFrom`, `dateTo` 파라미터 추가 |
| C2 계좌등록 | `POST /customer/payment-cards` — `type:bank` 지원 추가 |

---

## 5. 구현 순서 제안

1. **C3** 마지막 카드 삭제 방지 — 프론트엔드만 수정, 리스크 없음
2. **P3** 정산 CSV 다운로드 — 프론트엔드만 수정, 리스크 없음
3. **C1** 충전이력 + 대시보드 기간 필터 — 프론트+백엔드
4. **P2** 정산 기간 필터 — 프론트+백엔드
5. **P1** 충전단가 변경이력 — 백엔드 스키마 변경 포함
6. **C2** 계좌등록 — 스키마 검토 후 결정
7. **P4** 충전통계 트렌드 — 마지막 구현
