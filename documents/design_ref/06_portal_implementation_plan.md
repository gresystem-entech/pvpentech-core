# Chargeplus 사용자 포털 구현 계획서

## 개요

`https://www.pvpentech.kr` 을 통해 접속하는 사용자 포털.
기존 CSMS 백엔드(Evnest)와 연동하며, 3개 역할(고객센터/파트너/고객)별로 분리된 화면을 제공한다.

---

## 사용자 역할 정의

| 역할 | 코드 | 가입 승인 | 설명 |
|------|------|----------|------|
| 고객센터 | `cs` | Admin 승인 필요 | 전체 관리자 수준 접근 |
| 파트너 | `partner` | Admin 승인 필요 | 자신의 충전소/충전기 관리 |
| 고객 | `customer` | 즉시 활성화 | 본인 이력/카드만 조회 |

---

## 모델 설계

### 기존 User 모델 확장
```
role     : cs | partner | customer
status   : pending | active | inactive
password : 해싱 처리 (Django AbstractUser 기본 hasher)
```

### 신규: PartnerProfile
```
user          → OneToOne → User (role='partner')
business_name   사업체명
business_no     사업자번호
contact_phone   담당자 연락처
created_dttm
```

### 신규: PaymentCard (결제 카드 - 마스킹 저장, PG 연동 준비)
```
user          → FK → User
nickname        카드 별칭 (예: "내 신한카드")
card_last4      카드 끝 4자리 (마스킹 표시용)
card_type       Visa / Mastercard / 국내카드 등 (문자열)
billing_key     PG 빌링키 (추후 PG 연동 시 사용, 현재는 빈값)
is_default      기본 결제 카드 여부
created_at
```

### 신규: ChargingSite (충전소)
```
partner       → FK → PartnerProfile   (파트너 1 : 충전소 N)
site_name       충전소 이름
address         주소
unit_price      충전단가 (원/kWh) ← 충전소 단위 일괄 설정
created_dttm
```

### 기존 CpInfo (충전기) 수정
```
site          → FK → ChargingSite 추가   (충전소 1 : 충전기 N)
```

### 신규: FaultLog (충전기 장애이력)
```
charging_station  → FK → ChargingStation
reported_at         장애 발생 시각 (입력값, 기본=현재시각)
fault_type          장애 유형 (커넥터불량/통신오류/전원불량/기타)
description         장애 내용 (자유 텍스트)
resolved_at         복구 시각 (null=미복구)
reported_by         입력자 (CS 담당자 username)
created_at
```

### 기존: OcppMessage (OCPP 메시지 로그) - 이미 구현됨
```
station_id    충전기 ID
msg_id        메시지 UUID
direction     2=CP→CSMS / 3=CSMS→CP / 4=Error
action        메시지 액션명 (BootNotification, Authorize 등)
payload       메시지 내용 (JSON)
created_at    수신/발신 시각
```
보관기간: `ocpp_message_log_retention_days` CsmsVariable로 설정 (기본 30일)
만료 메시지는 Celery periodic task로 자동 삭제.

---

## 가입 및 승인 흐름

```
[고객 가입]
  /register/customer/ → 즉시 status=active → 로그인 가능

[파트너 가입]
  /register/partner/ → status=pending → CS 포털에서 승인 → status=active

[고객센터 가입]
  /register/cs/ → status=pending → Django /admin/ 에서 승인 → status=active
```

---

## URL 구조

```
/                          로그인 (공통)
/register/                 가입 역할 선택
/register/customer/        고객 가입 폼
/register/partner/         파트너 가입 폼 (+사업체명, 사업자번호)
/register/cs/              고객센터 가입 폼

/portal/cs/                고객센터 대시보드 (서비스 현황 포함)
/portal/cs/users/          사용자 목록
/portal/cs/users/create/   사용자 추가
/portal/cs/users/<id>/     사용자 상세/수정
/portal/cs/users/<id>/delete/  사용자 삭제
/portal/cs/partners/       파트너 목록
/portal/cs/partners/create/    파트너 추가
/portal/cs/partners/<id>/      파트너 상세/수정
/portal/cs/partners/<id>/delete/  파트너 삭제
/portal/cs/chargers/       충전기 목록
/portal/cs/chargers/create/    충전기 추가
/portal/cs/chargers/<id>/      충전기 상세
/portal/cs/chargers/<id>/delete/   충전기 삭제
/portal/cs/chargers/<id>/fault/    장애이력 입력
/portal/cs/sites/          충전소 목록
/portal/cs/sites/create/   충전소 등록
/portal/cs/sessions/       충전이력 (20건 페이징, 기간/충전소/충전기/사용자 검색)
/portal/cs/ops/config/     운영변수 설정  (구 시스템 설정)
/portal/cs/ops/msglog/     메세지 로그   (기간/충전기 검색)

/portal/partner/           파트너 대시보드 (내 충전소 현황)
/portal/partner/sites/     내 충전소 목록 + 단가 설정
/portal/partner/chargers/  내 충전기 상태 (폴링 방식)
/portal/partner/stats/     통계 (당월 충전량/금액/건수)

/portal/customer/          고객 대시보드
/portal/customer/history/  내 충전이력
/portal/customer/cards/    내 카드 관리 (RFID)
/portal/customer/profile/  프로필 수정
```

---

## 역할별 기능 상세

### 고객센터 (cs)

#### 대시보드
- 전체 요약 통계 (충전기수/고객수/파트너수/당월충전건수)
- 서비스 현황 탭 (기본: 일별)
  - **일별**: 지난 4일 각 날짜별 — 충전량(kWh)/전일대비증감 / 결제금액(원)/전일대비증감 / 충전횟수/전일대비증감 / [상세내역]
  - **주별**: 지난 4주 각 주별 — 동일 항목 / 전주대비증감 / [상세내역]
  - **월별**: 지난 4달 각 월별 — 동일 항목 / 전월대비증감 / [상세내역]
  - [상세내역]: 해당 기간 충전소별/충전기별 충전량/결제금액/충전횟수 및 각각의 증감

#### 사용자 관리
- 목록 조회 (역할/상태/키워드 필터)
- 사용자 추가 (CS가 직접 생성)
- 사용자 상세/수정 (기본정보 + 결제카드 목록 조회/등록/삭제)
- 사용자 삭제 (소프트 삭제: is_active=False)
- 활성/비활성 토글

#### 파트너 관리
- 목록 조회 (승인대기 필터 포함)
- 파트너 추가 (CS가 직접 생성 — User + PartnerProfile 동시)
- 파트너 상세/수정 (기본정보 + 소속 충전소 + 충전기 현황)
- 파트너 삭제
- 승인/반려 처리

#### 충전기 관리
- 목록 조회 (상태/키워드 필터)
- 충전기 추가 (ChargingStation 레코드 생성)
- 충전기 상세 (기본정보 + 충전이력 + 장애이력)
- 충전기 삭제 (소프트 삭제: is_active=False)
- 장애이력 등록

#### 충전이력
- 20건 페이징
- 기간 선택 (시작일~종료일)
- 충전소별/충전기별/사용자별 검색

#### 시스템 운영 (구: 시스템 설정)
- **운영변수 설정**: CsmsVariable 조회/수정 (ocpp_message_log_retention_days 포함)
- **메세지 로그**: OcppMessage 조회 — 시간/충전기ID/메시지ID/방향/내용 표시, 기간·충전기 검색, 20건 페이징

### 파트너 (partner)
- 본인 소속 충전소만 조회
- 충전소별 충전단가(unit_price) 변경
- 소속 충전기 상태 모니터링 (30초 폴링)
- 통계: 당월/전월 충전량(kWh), 충전금액(원), 충전건수

### 고객 (customer)
- 본인 충전이력 조회
- 본인 카드 조회/등록 (RFID)
- 프로필(이름/연락처/이메일) 수정

---

## 구현 단계 (Phase)

### Phase 1 — 기반 (인증/모델) ✅ 완료
- [x] User 모델에 role, status 필드 추가
- [x] PartnerProfile 모델 생성
- [x] ChargingSite 모델 생성
- [x] CpInfo에 site FK 추가
- [x] migration 작성
- [x] 역할 검증 데코레이터 작성
- [x] 로그인 후 역할별 리다이렉트
- [x] 역할별 가입 폼

### Phase 2 — 고객센터 포털 기본 ✅ 완료
- [x] 대시보드 (기본 통계)
- [x] 사용자 목록/상태 토글
- [x] 파트너 승인 관리
- [x] 충전기/충전소 목록
- [x] 운영변수 설정

### Phase 3 — 고객센터 포털 확장 (현재)
- [ ] PaymentCard 모델 추가
- [ ] FaultLog 모델 추가
- [ ] OcppMessage 보관기간 변수 추가 (ocpp_message_log_retention_days)
- [ ] OcppMessage 자동 삭제 Celery periodic task
- [ ] 대시보드 서비스 현황 탭 (일/주/월별 + 상세내역)
- [ ] 사용자 추가/상세/수정/삭제 + 결제카드 관리
- [ ] 파트너 추가/상세/수정/삭제
- [ ] 충전기 추가/상세/삭제 + 장애이력
- [ ] 충전이력 개선 (페이징/필터)
- [ ] 시스템 운영 메뉴 구조 변경 (운영변수 설정 + 메세지 로그)

### Phase 4 — 파트너 포털 ✅ 완료
- [x] 파트너 대시보드
- [x] 내 충전소 + 단가 변경
- [x] 충전기 상태 폴링
- [x] 통계

### Phase 5 — 고객 포털 ✅ 완료
- [x] 고객 대시보드
- [x] 충전이력
- [x] RFID 카드 관리
- [x] 프로필 수정

---

## 기술 스택

- Backend: Django (REST API는 DRF+JWT, 포털은 세션 기반)
- Frontend: Bootstrap 5 + Django Templates
- Auth: 세션 기반 (포털), JWT (모바일 API)
- 충전기 상태 폴링: JavaScript setInterval (30초)
- OCPP 메시지 로깅: 이미 구현됨 (OcppMessage 모델 + log_ocpp_message 함수)
- 메시지 로그 보관: Celery periodic task로 만료 삭제

---

*최초 작성: 2026-03-16*
*업데이트: 2026-03-16 (Phase 3 추가 — 서비스현황/CRUD/메세지로그)*
