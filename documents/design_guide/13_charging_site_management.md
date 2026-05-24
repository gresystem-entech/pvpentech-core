# 13. 충전소 관리 설계 가이드

- **버전**: v1.0
- **작성일**: 2026-04-14
- **대상**: Node.js 백엔드 개발자, 프론트엔드 개발자
- **참조**: `design_ref/charging_site.md`, `design_guide/04_database_schema.md`, `design_guide/05_rest_api_design.md`

---

## 1. 개요

Pvpentech의 충전소(ChargingSite)는 파트너(site owner)가 소유하며, CS 운영자가 전체를 관리합니다. 하나의 충전소에 여러 대의 충전기(ChargingStation)가 속합니다.

### 도메인 관계

```
PartnerProfile (1) ──── (N) ChargingSite (1) ──── (N) ChargingStation
                                │
                                └── 충전단가(unitPrice), 관리자정보, 충전사업자
```

---

## 2. DB 스키마 (ChargingSite)

```prisma
model ChargingSite {
  id                   Int       @id @default(autoincrement())
  siteName             String    @db.VarChar(200)          // 충전소명 (필수)
  address              String?   @db.VarChar(500)          // 주소
  unitPrice            Decimal   @default(250) @db.Decimal(10, 2)  // 단가(원/kWh)
  partnerId            Int?                                // 소속 파트너
  chargeOperatorName   String?   @db.VarChar(200)          // 충전사업자명
  managerName          String?   @db.VarChar(100)          // 충전소 관리자명
  managerPhone         String?   @db.VarChar(20)           // 충전소 관리자 전화번호
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  partner          PartnerProfile?    @relation(...)
  chargingStations ChargingStation[]
  settlements      Settlement[]

  @@map("charging_site")
}
```

---

## 3. API 엔드포인트

### 3.1 CS 포털 (`/api/portal/cs/sites`)

| Method | Path | 설명 | 권한 |
|--------|------|------|------|
| GET | `/api/portal/cs/sites` | 충전소 목록 (검색/페이지네이션) | cs |
| POST | `/api/portal/cs/sites` | 충전소 등록 | cs |
| GET | `/api/portal/cs/sites/:id` | 충전소 상세 | cs |
| PUT | `/api/portal/cs/sites/:id` | 충전소 전체 수정 | cs |
| DELETE | `/api/portal/cs/sites/:id` | 충전소 삭제 | cs |
| PATCH | `/api/portal/cs/sites/:id/price` | 충전단가만 수정 | cs |
| GET | `/api/portal/cs/sites/:id/transactions` | 충전소별 충전이력 | cs |
| GET | `/api/portal/cs/sites/:id/faults` | 충전소별 장애이력 | cs |

### 3.2 파트너 포털 (`/api/portal/partner/sites`)

| Method | Path | 설명 | 권한 |
|--------|------|------|------|
| GET | `/api/portal/partner/sites` | 내 충전소 목록 | partner |
| GET | `/api/portal/partner/sites/:id` | 충전소 상세 (읽기전용) | partner |
| PUT | `/api/portal/partner/sites/:id/price` | 충전단가 수정 | partner |

---

## 4. 요청/응답 형식

### 4.1 충전소 목록 조회

**Request**
```
GET /api/portal/cs/sites?page=1&limit=20&keyword=강남
```

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| page | number | 페이지 번호 (기본 1) |
| limit | number | 페이지당 항목 수 (기본 20) |
| keyword | string | 검색어 (충전소명 / **파트너명** / 주소) |
| partnerId | number | 파트너 필터 |

**Response**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "siteName": "강남역 충전소",
        "address": "서울시 강남구 ...",
        "unitPrice": "280.00",
        "partnerId": 5,
        "partner": { "id": 5, "businessName": "강남파트너" },
        "_count": { "chargingStations": 4 },
        "createdAt": "2026-03-01T00:00:00.000Z"
      }
    ],
    "total": 12,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

> **중요**: 목록 API는 `_count.chargingStations`(충전기 수)만 반환. 충전기 배열 전체는 상세 API에서만 반환.

### 4.2 충전소 등록/수정 Request Body

```json
{
  "site_name": "강남역 충전소",
  "partner_id": 5,
  "address": "서울시 강남구 강남대로 123",
  "charge_operator_name": "충전플러스",
  "manager_name": "홍길동",
  "manager_phone": "010-1234-5678",
  "unit_price": 280
}
```

### 4.3 충전단가 수정

```
PATCH /api/portal/cs/sites/:id/price
PUT   /api/portal/partner/sites/:id/price
```

```json
{ "unit_price": 300 }
```

### 4.4 충전소별 충전이력

```
GET /api/portal/cs/sites/:id/transactions?page=1&limit=10
```

**Response 핵심 필드**

| 필드 | 설명 |
|------|------|
| timeStart | 충전 시작일시 |
| stationId | 충전기 ID |
| meterStart / meterEnd | Wh 단위 — kWh 변환: `(meterEnd - meterStart) / 1000` |
| costKrw | 충전금액 (원) |
| status | Pending / Active / Stopped / Failed |

### 4.5 충전소별 장애이력

```
GET /api/portal/cs/sites/:id/faults
```

**Response 핵심 필드**

| 필드 | 설명 |
|------|------|
| reportedAt | 장애 발생일시 |
| stationId | 충전기 ID |
| faultType | ConnectorFault / CommunicationError / PowerFault / Other |
| resolvedAt | 해결일시 (null이면 미처리) |

---

## 5. 충전단가 적용 메커니즘

```
충전단가 변경 (PATCH /sites/:id/price)
        │
        ▼
DB unitPrice 즉시 업데이트
        │
        ▼
이후 새로 시작되는 충전 트랜잭션에만 적용
(진행 중인 충전 세션에는 영향 없음)
        │
        ▼
충전 종료 시 (POST /api/charge/stop)
charge.service.ts의 stopCharge()에서
  → transaction.station.site.unitPrice 조회
  → Math.floor(finalKwh * unitPrice) = costKrw
```

**핵심**: 요금 계산은 충전 **종료 시점**에 `site.unitPrice`를 조회하므로, 단가 변경 후 종료되는 세션에는 새 단가가 적용됩니다.

---

## 6. 검색 필터 명세

| 검색 대상 | DB 컬럼 | Prisma 조건 |
|-----------|---------|------------|
| 충전소명 | `charging_site.site_name` | `{ siteName: { contains: keyword, mode: 'insensitive' } }` |
| 파트너명 | `partner_profile.business_name` | `{ partner: { businessName: { contains: keyword, mode: 'insensitive' } } }` |
| 주소 | `charging_site.address` | `{ address: { contains: keyword, mode: 'insensitive' } }` |

세 조건은 `OR`로 결합됩니다.

---

## 7. 서비스 레이어 (SiteService)

```typescript
// src/services/site.service.ts
async list(params: { page?, limit?, keyword?, partnerId? }) {
  // keyword 검색: siteName OR partner.businessName OR address
  // 목록 응답: _count.chargingStations (배열 전체 X)
}

async findById(id: number) {
  // 상세 응답: partner, chargingStations 배열 포함
}

async updatePrice(id: number, unitPrice: number) {
  // 단가만 업데이트
}
```

---

## 8. 역할별 접근 권한

| 기능 | CS | 파트너 | 고객 |
|------|-----|--------|------|
| 충전소 목록 | 전체 | 본인 소속만 | ✕ |
| 충전소 등록/삭제 | ✅ | ✕ | ✕ |
| 충전소 상세 수정 | ✅ | ✕ | ✕ |
| 충전단가 수정 | ✅ | ✅ (본인 소속) | ✕ |
| 충전이력 조회 | ✅ | 본인 소속 충전소 | ✕ |
| 장애이력 조회 | ✅ | 본인 소속 (읽기) | ✕ |

---

## 9. 체크리스트

- [x] `ChargingSite` 모델에 `chargeOperatorName`, `managerName`, `managerPhone` 필드 포함
- [x] 충전소 목록 API — keyword 검색 (충전소명/파트너명/주소)
- [x] 충전소 목록 응답 최적화 — `_count.chargingStations` 사용
- [x] CS 포털 `PATCH /sites/:id/price` endpoint 구현
- [x] 파트너 포털 `PUT /sites/:id/price` endpoint 구현
- [x] 충전단가 변경 후 새 트랜잭션부터 적용 (charge.service.ts)
- [x] 충전소별 충전이력 조회 `GET /sites/:id/transactions`
- [x] 충전소별 장애이력 조회 `GET /sites/:id/faults`
- [x] 파트너 포털 프론트엔드 단가 수정 URL/Body 정합성 확인
