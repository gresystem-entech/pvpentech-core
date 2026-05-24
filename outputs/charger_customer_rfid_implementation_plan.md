# 충전기 관리 / 사용자 관리 / 충전카드 관리 기능 보완 계획

- **작성일**: 2026-04-15
- **참조**: `documents/design_ref/customer_charger_details.md`

---

## 1. 현황 분석 (Gap Analysis)

### 1.1 충전기 관리

| 요구사항 | 현재 구현 | 상태 |
|---------|-----------|------|
| 충전기 목록 (ID, 충전소명, 제조사, 시리얼, 펌웨어, 상태, 마지막연결) | 구현됨 | ✅ |
| 충전기 목록 — **오늘 충전량(kWh)** 컬럼 | 미구현 | ❌ |
| 충전기 검색 (ID, **충전소명**, 제조사, 시리얼, **펌웨어**) | ID+시리얼만 가능, 충전소명·펌웨어 검색 누락 | ⚠️ |
| 페이지당 표시 개수 설정 (20/50/100) | URL limit 파라미터 있으나 UI 없음 | ⚠️ |
| 충전기 삭제 | 구현됨 (소프트 삭제) | ✅ |
| Heartbeat 수신일시 저장 | 구현됨 (lastHeartbeatAt) | ✅ |
| 충전기 상태 세분화 (조치중, 통신장애, 상태미확인) | Online/Offline/Faulted만 지원 | ❌ |
| Offline 상태 이력 저장 | 미구현 (테이블 없음) | ❌ |
| Offline 상태 충전기 목록 조회 | 미구현 | ❌ |

### 1.2 사용자 관리

| 요구사항 | 현재 구현 | 상태 |
|---------|-----------|------|
| 사용자 목록 조회 (20개/페이지) | 구현됨 | ✅ |
| 사용자 검색 (ID, 이름, email, **전화번호**, **역할**, **상태**) | username+email+firstName만, 전화번호·역할·상태 필터 UI 없음 | ⚠️ |
| 사용자 정보 변경 (성/이름/이메일/전화/언어/상태) | 구현됨 | ✅ |
| 파트너 회원가입 승인 | 구현됨 | ✅ |
| 사용자 결제카드 정보 | 구현됨 | ✅ |

### 1.3 충전카드 관리

| 요구사항 | 현재 구현 | 상태 |
|---------|-----------|------|
| 충전카드 등록 | 구현됨 | ✅ |
| 충전카드 정보 변경 (타입, 상태) | 구현됨 | ✅ |
| **충전카드 삭제** | **API 없음 (DELETE endpoint 미구현)** | ❌ |
| **충전카드 일괄등록 (CSV)** | 미구현 | ❌ |
| **충전카드 예제 CSV 파일 다운로드** | 미구현 | ❌ |
| **충전카드 검색 (RFID, 사용자ID)** | 검색 input·API 모두 없음 | ❌ |

### 1.4 DB 스키마 누락 항목

| 항목 | 내용 | 필요 조치 |
|------|------|-----------|
| `StationStatus` enum | Online/Offline/Faulted → Inspecting, CommunicationFault, Unknown 추가 필요 | **마이그레이션** |
| `offline_log` 테이블 | Offline 상태 이력 저장 테이블 없음 | **신규 테이블 추가** |

---

## 2. 실행 계획

### Phase 1: DB 스키마 확장 + 마이그레이션

#### Task 1-1: StationStatus enum 확장
**수정 파일**: `prisma/schema.prisma`

```prisma
enum StationStatus {
  Online           // 정상 연결, 대기
  Offline          // 통신 끊김 (연결 없음)
  Faulted          // 장애 발생
  Inspecting       // 조치중 (기사 현장 출동)
  CommunicationFault  // 통신장애 (연결됐으나 응답 이상)
  Unknown          // 상태 미확인
}
```

화면 표시 매핑:
| enum | 화면 표시 | 색상 |
|------|-----------|------|
| Online | 대기 | green |
| Offline | 통신장애 | red |
| Faulted | 장애 | red |
| Inspecting | 조치중 | orange |
| CommunicationFault | 통신장애 | red |
| Unknown | 상태미확인 | gray |

#### Task 1-2: OfflineLog 테이블 추가
**수정 파일**: `prisma/schema.prisma`

```prisma
model OfflineLog {
  id          Int       @id @default(autoincrement())
  stationId   String    @db.VarChar(50)
  siteId      Int?
  partnerId   Int?
  status      StationStatus             // 기록 시점의 상태
  loggedAt    DateTime  @default(now()) // offline으로 확정된 일시
  resolvedAt  DateTime?                 // 복구 일시

  station     ChargingStation @relation(fields: [stationId], references: [id])

  @@index([stationId, loggedAt])
  @@index([loggedAt])
  @@map("offline_log")
}
```

#### Task 1-3: 마이그레이션 실행
```bash
npx prisma migrate dev --name add_station_status_offline_log
```

---

### Phase 2: 백엔드 API 보완

#### Task 2-1: 충전기 목록 — 오늘 충전량 집계 추가
**수정 파일**: `src/services/station.service.ts`

`list()` 반환 시 오늘(자정~현재) 완료된 트랜잭션의 충전량 합계 추가:

```typescript
// list() 내부에서 today 집계
const today = new Date();
today.setHours(0, 0, 0, 0);

const todayKwhMap = await prisma.transaction.groupBy({
  by: ['stationId'],
  where: {
    status: 'Stopped',
    timeStart: { gte: today },
    stationId: { in: items.map(s => s.id) },
  },
  _sum: { meterEnd: true, meterStart: true },
});
// meterEnd-meterStart Wh → /1000 kWh
```

응답에 `todayKwh` 필드 추가.

#### Task 2-2: 충전기 검색 필드 확장
**수정 파일**: `src/services/station.service.ts`

현재: `id`, `modelName`, `vendorName`
추가: `site.siteName`, `firmwareVersion`, `serialNumber`

```typescript
where['OR'] = [
  { id: { contains: keyword } },
  { vendorName: { contains: keyword } },
  { manufacturer: { contains: keyword } },
  { serialNumber: { contains: keyword } },
  { firmwareVersion: { contains: keyword } },
  { site: { siteName: { contains: keyword } } },  // 신규
];
```

#### Task 2-3: Offline 이력 자동 저장
**수정 파일**: `src/ocpp/handlers/statusNotification.handler.ts`
또는 OCPP connection 이벤트 핸들러

충전기 상태가 Offline-계열로 전환 시 `offline_log` 자동 기록:

```typescript
// statusNotification 또는 disconnect 이벤트에서
if (['Offline', 'Faulted', 'CommunicationFault', 'Unknown'].includes(newStatus)) {
  await prisma.offlineLog.create({
    data: { stationId, siteId, partnerId, status: newStatus }
  });
}
```

#### Task 2-4: Offline 충전기 목록 조회 API
**수정 파일**: `src/routes/portal/cs/stations.routes.ts`

```
GET /api/portal/cs/stations/offline
  ?startDate=2026-04-01
  &endDate=2026-04-15
  (기간 미설정 시 현재 Offline 상태 충전기)
```

#### Task 2-5: 충전카드 삭제 API 추가
**수정 파일**: `src/routes/portal/cs/idTokens.routes.ts`

```
DELETE /api/portal/cs/id-tokens/:id
```

#### Task 2-6: 충전카드 CSV 일괄등록 API
**수정 파일**: `src/routes/portal/cs/idTokens.routes.ts`

```
POST /api/portal/cs/id-tokens/bulk-upload
Content-Type: multipart/form-data
파라미터: file (CSV)
```

CSV 컬럼: `idTag`, `type`, `userId`(optional)
- multer 미들웨어로 파일 수신
- csv-parse 또는 직접 파싱
- 기존 idTag 중복은 skip (append 방식)
- 결과 반환: `{ created: N, skipped: N, errors: [...] }`

#### Task 2-7: 충전카드 예제 CSV 다운로드 API
**수정 파일**: `src/routes/portal/cs/idTokens.routes.ts`

```
GET /api/portal/cs/id-tokens/sample-csv
```

반환: `Content-Disposition: attachment; filename="rfid_sample.csv"`
내용:
```csv
idTag,type,userId
04:A1:B2:C3:D4:E5,ISO14443,
04:F1:E2:D3:C4:B5,Local,42
```

#### Task 2-8: 충전카드 검색 API 확장
**수정 파일**: `src/routes/portal/cs/idTokens.routes.ts`

현재 `GET /id-tokens`에 keyword 검색 없음 → 추가:

```typescript
const where: Prisma.IdTokenWhereInput = {};
if (keyword) {
  where.OR = [
    { idTag: { contains: keyword, mode: 'insensitive' } },
    { user: { username: { contains: keyword, mode: 'insensitive' } } },
  ];
}
```

#### Task 2-9: 사용자 검색에 전화번호 + 역할/상태 필터 추가
**수정 파일**: `src/services/user.service.ts`

현재 `list()` keyword 검색: username + email + firstName
추가: `phone`

```typescript
where['OR'] = [
  { username: { contains: keyword } },
  { email: { contains: keyword } },
  { firstName: { contains: keyword } },
  { phone: { contains: keyword } },  // 신규
];
```

---

### Phase 3: 프론트엔드 보완

#### Task 3-1: 충전기 목록 — 오늘 충전량 컬럼 추가
**수정 파일**: `public/portal/cs/index.html`

- 테이블 헤더에 `오늘 충전량(kWh)` 컬럼 추가
- 응답의 `todayKwh` 필드 표시 (없으면 `-`)

#### Task 3-2: 충전기 목록 — 페이지당 개수 선택 UI
**수정 파일**: `public/portal/cs/index.html`

- 목록 툴바에 `[20개▼]` select box 추가 (20/50/100)
- 선택 즉시 `loadStations(1, keyword, limit)` 재호출

#### Task 3-3: 충전기 검색 placeholder 업데이트
**수정 파일**: `public/portal/cs/index.html`

- `"충전기ID, 시리얼 검색..."` → `"충전기ID, 충전소명, 제조사, 시리얼, 펌웨어 검색..."`

#### Task 3-4: 충전카드 목록 — 검색 input 추가
**수정 파일**: `public/portal/cs/index.html`

- 목록 툴바에 검색 input 추가
- `"RFID 번호, 사용자ID 검색..."` placeholder
- URL에 keyword 파라미터 포함하도록 `loadIdTokens` 수정

#### Task 3-5: 충전카드 목록 — 삭제 버튼 추가
**수정 파일**: `public/portal/cs/index.html`

- 상세 모달 하단에 `삭제` 버튼 추가
- `DELETE /api/portal/cs/id-tokens/:id` 호출 후 목록 갱신

#### Task 3-6: 충전카드 CSV 일괄등록 / 예제 다운로드 UI
**수정 파일**: `public/portal/cs/index.html`

- 충전카드 목록 상단에 `CSV 일괄등록` + `예제 CSV 다운로드` 버튼 추가
- CSV 일괄등록 버튼 클릭 → 파일 선택 input → 업로드 → 결과 표시 (N건 등록, N건 중복 skip)

#### Task 3-7: 사용자 목록 — 검색 placeholder 업데이트
**수정 파일**: `public/portal/cs/index.html`

- `"아이디, 이름, 이메일 검색..."` → `"아이디, 이름, 이메일, 전화번호 검색..."`

---

### Phase 4: 설계 가이드 문서화

#### Task 4-1: 충전기/사용자/충전카드 관리 설계 가이드 작성
**신규 파일**: `documents/design_guide/15_station_user_rfid_management.md`

---

## 3. 수정/신규 파일 목록

| 파일 | 작업 | Phase |
|------|------|-------|
| `prisma/schema.prisma` | StationStatus enum 확장, OfflineLog 테이블 추가 | 1 |
| `prisma/migrations/` | 마이그레이션 | 1 |
| `src/services/station.service.ts` | 오늘 충전량 집계, 검색 필드 확장 | 2 |
| `src/ocpp/handlers/statusNotification.handler.ts` | Offline 이력 자동 저장 | 2 |
| `src/routes/portal/cs/stations.routes.ts` | Offline 목록 조회 endpoint | 2 |
| `src/routes/portal/cs/idTokens.routes.ts` | 삭제/CSV업로드/예제다운로드/검색 API | 2 |
| `src/services/user.service.ts` | 전화번호 검색 추가 | 2 |
| `public/portal/cs/index.html` | 충전기/충전카드/사용자 UI 보완 | 3 |
| `documents/design_guide/15_station_user_rfid_management.md` | 설계 가이드 | 4 |

---

## 4. 우선순위

| 우선순위 | 항목 | 이유 |
|----------|------|------|
| **P0** | 충전카드 삭제 API + UI | 삭제 기능 완전 부재 |
| **P0** | 충전카드 검색 API + UI | 카드 수 많아지면 찾을 방법 없음 |
| **P1** | 충전기 오늘 충전량 컬럼 | 운영 모니터링 핵심 지표 |
| **P1** | 충전기 검색 필드 확장 (충전소명) | 운영 시 충전소명으로 검색이 가장 자연스러움 |
| **P1** | 충전카드 CSV 일괄등록 + 예제 다운로드 | 초기 카드 대량 등록 필요 |
| **P2** | StationStatus enum 확장 + Offline 이력 | 장애 모니터링 고도화 |
| **P2** | 페이지당 개수 설정 UI | UX 개선 |
| **P2** | 사용자 검색 전화번호 추가 | 검색 완성도 |
| **P3** | 설계 가이드 문서화 | 유지보수 참조 |

---

## 5. 주요 설계 결정

### 5.1 오늘 충전량 계산 전략
- `transaction.timeStart >= 오늘 자정` AND `status = 'Stopped'` 조건
- `(meterEnd - meterStart) / 1000` → kWh
- 목록 API 내부에서 `groupBy stationId` 집계 후 join
- 성능: 충전기 수 × 오늘 트랜잭션 수 — 인덱스(`station_id`, `time_start`)로 충분히 빠름

### 5.2 CSV 일괄등록 전략
- `multer` 라이브러리로 메모리 버퍼에서 처리 (파일 저장 없이)
- `idTag` 중복 → skip (기존 카드 영향 없음)
- 잘못된 행은 error 배열로 수집 후 결과 반환
- 한 번에 최대 1,000개 제한

### 5.3 OfflineLog 저장 시점
- WebSocket disconnect 이벤트 발생 시 → `Offline` 기록
- StatusNotification에서 `Faulted` 수신 시 → `Faulted` 기록
- 복구(reconnect) 시 해당 레코드의 `resolvedAt` 업데이트

---

## 6. 테스트 시나리오

| 시나리오 | 예상 결과 |
|----------|-----------|
| 충전기 목록 조회 | 오늘 충전량 kWh 컬럼 표시 |
| "강남" 키워드로 충전기 검색 | 충전소명에 "강남" 포함된 충전기 반환 |
| 충전카드 단건 삭제 | DB에서 삭제, 목록 갱신 |
| "04:A1" 키워드로 충전카드 검색 | 해당 idTag 포함 카드 반환 |
| CSV 파일 업로드 (10건, 2건 중복) | 8건 등록, 2건 skip 결과 반환 |
| 예제 CSV 다운로드 | 헤더(idTag, type, userId) + 예제 2행 CSV 다운로드 |
| 충전기 Offline → DB 이력 | offline_log에 stationId, status, loggedAt 저장 |
| 사용자 "010-1234" 검색 | phone 컬럼 포함 검색 결과 반환 |
