# 충전소 관리 기능 상세 구현 계획

- **작성일**: 2026-04-14
- **참조**: `documents/design_ref/charging_site.md`
- **작성자**: 분석 기반 자동 생성

---

## 1. 현황 분석 (Gap Analysis)

### 1.1 요구사항 vs 구현 현황

| 요구사항 (charging_site.md) | 현재 구현 | 상태 |
|-----------------------------|-----------|------|
| 충전소 목록 조회 (파트너ID, 충전기수, 단가, 등록일) | 구현됨 (단, 충전기 배열 전체 반환으로 비효율) | ⚠️ 개선 필요 |
| 충전소 검색 (충전소명, **파트너명**, 주소) | 충전소명+주소만 가능, **파트너명 검색 누락** | ❌ 버그 |
| 충전소 상세정보 (충전사업자명, 관리자명/전화) | 구현됨 (DB 필드 포함, API 반환) | ✅ |
| 충전소별 충전단가 설정 (CS 포털) | PUT /:id 전체 수정으로 가능, 명시적 endpoint 없음 | ⚠️ 개선 필요 |
| 충전소별 충전단가 설정 (파트너 포털) | route 구현됨 but **프론트 URL 불일치** | ❌ 버그 |
| 충전단가 변경 후 새 트랜잭션부터 적용 | charge.service.ts에서 stopCharge 시 site.unitPrice 조회 | ✅ |
| 충전소별 충전이력 조회 (kWh, 금액, 상태) | GET /:id/transactions 구현, kWh 프론트 계산 | ✅ |
| 충전소별 장애이력 조회 (발생일시, 충전기ID) | GET /:id/faults 구현됨 | ✅ |

### 1.2 발견된 버그 (즉시 수정 필요)

#### Bug #1: 파트너 포털 단가 수정 API URL 불일치
- **프론트엔드** 호출: `PUT /api/portal/partner/sites/${siteId}/unit-price`
- **백엔드** route: `PUT /:id/price`
- **결과**: 404 오류로 단가 수정 불가

#### Bug #2: 파트너 포털 단가 수정 요청 body 불일치
- **프론트엔드** 전송: `{ unitPrice: number }` (camelCase)
- **백엔드** 기대값: `{ unit_price: number }` (snake_case)
- **결과**: 유효성 검사 실패로 수정 불가

---

## 2. 실행 계획

### Phase 1: 버그 수정 (Bug Fixes)

#### Task 1-1: 파트너 포털 단가 수정 URL & Body 불일치 수정
**수정 범위**: `public/portal/partner/index.html`
- URL: `/sites/${siteId}/unit-price` → `/sites/${siteId}/price`
- Body: `{ unitPrice }` → `{ unit_price: unitPrice }`

---

### Phase 2: 백엔드 API 보완

#### Task 2-1: 충전소 검색에 파트너명 추가
**수정 파일**: `src/services/site.service.ts`
- `list()` 메서드의 keyword 검색에 `partner.businessName` 추가
- Prisma nested relation 필터 사용

**현재 코드**:
```typescript
if (params.keyword) {
  where['OR'] = [
    { siteName: { contains: params.keyword, mode: 'insensitive' } },
    { address: { contains: params.keyword, mode: 'insensitive' } },
  ];
}
```

**변경 후**:
```typescript
if (params.keyword) {
  where['OR'] = [
    { siteName: { contains: params.keyword, mode: 'insensitive' } },
    { address: { contains: params.keyword, mode: 'insensitive' } },
    { partner: { businessName: { contains: params.keyword, mode: 'insensitive' } } },
  ];
}
```

#### Task 2-2: 충전소 목록 응답 최적화
**수정 파일**: `src/services/site.service.ts`
- `list()` 메서드에서 `chargingStations: true` 대신 `_count: { select: { chargingStations: true } }`로 변경
- 목록에서는 충전기 배열 전체가 불필요 (수만 필요)
- `findById()`는 충전기 목록이 필요하므로 그대로 유지

#### Task 2-3: CS 포털 충전단가 명시적 endpoint 추가
**수정 파일**: `src/routes/portal/cs/sites.routes.ts`
- `PATCH /:id/price` endpoint 추가
- SiteController의 `updatePrice` 핸들러 재사용

---

### Phase 3: 프론트엔드 보완

#### Task 3-1: CS 포털 충전소 검색 placeholder 업데이트
**수정 파일**: `public/portal/cs/index.html`
- 검색 input placeholder: "충전소명, 주소 검색..." → "충전소명, 파트너명, 주소 검색..."

#### Task 3-2: CS 포털 충전소 상세 - 충전단가 수정 UX 개선
**수정 파일**: `public/portal/cs/index.html`
- 충전소 상세 모달에 단가 수정 후 즉시 반영 안내 메시지 추가
- "변경 완료 후 새로운 충전 시작 시점부터 적용됩니다." 문구 표시

---

### Phase 4: 설계 가이드 문서화

#### Task 4-1: 충전소 관리 상세 설계 가이드 작성
**신규 파일**: `documents/design_guide/13_charging_site_management.md`
- DB 스키마 (ChargingSite 모델)
- API 엔드포인트 전체 목록 (CS/파트너 포털)
- 충전단가 적용 메커니즘 설명
- 검색 필터 명세
- 프론트엔드 화면 구성 가이드

---

## 3. 수정 파일 목록 요약

| 파일 | 작업 | Phase |
|------|------|-------|
| `public/portal/partner/index.html` | URL/Body 불일치 수정 | 1 |
| `src/services/site.service.ts` | 파트너명 검색 추가, 목록 응답 최적화 | 2 |
| `src/routes/portal/cs/sites.routes.ts` | PATCH /:id/price endpoint 추가 | 2 |
| `public/portal/cs/index.html` | 검색 placeholder 업데이트, 단가 안내 문구 | 3 |
| `documents/design_guide/13_charging_site_management.md` | 신규 설계 가이드 문서 | 4 |

---

## 4. 우선순위

| 우선순위 | 항목 | 이유 |
|----------|------|------|
| **P0 (즉시)** | Bug #1 파트너 단가 수정 URL 불일치 | 파트너 핵심 기능 동작 안 함 |
| **P0 (즉시)** | Bug #2 파트너 단가 수정 body 불일치 | 동일 이유 |
| **P1 (높음)** | 충전소 검색 파트너명 추가 | 운영 요구사항 직접 누락 |
| **P1 (높음)** | CS 포털 PATCH /:id/price 추가 | API 명세 준수 |
| **P2 (중간)** | 목록 응답 최적화 | 성능 개선 (충전소/충전기 수 많아질 때 문제) |
| **P3 (낮음)** | 프론트엔드 UX 개선 | 사용성 향상 |
| **P3 (낮음)** | 설계 가이드 문서화 | 유지보수 참조용 |

---

## 5. 테스트 시나리오

| 시나리오 | 예상 결과 |
|----------|-----------|
| 파트너 포털에서 충전소 단가 수정 | 단가가 즉시 DB에 반영됨 |
| 단가 변경 후 새 충전 시작 → 충전 완료 | 변경된 단가로 요금 계산됨 |
| CS 포털에서 "강남" 키워드 검색 | 충전소명, 주소, 파트너명에 "강남" 포함된 모든 충전소 반환 |
| CS 포털에서 PATCH /sites/:id/price | 단가만 업데이트, 다른 필드 영향 없음 |
| 충전소 상세에서 충전이력 탭 | 해당 충전소의 모든 충전기 이력 페이지네이션 표시 |
| 충전소 상세에서 장애이력 탭 | 해당 충전소의 모든 충전기 장애이력 표시 |
