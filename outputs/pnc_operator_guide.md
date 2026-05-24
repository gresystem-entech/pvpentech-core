# Pvpentech CSMS — ISO 15118 PnC 운영자 가이드

- **작성일**: 2026-05-11
- **대상**: Pvpentech CSMS 운영 관리자 (CS role)
- **CSMS 버전**: PnC Phase A-1 ~ B-2 + UI 모두 머지된 시점 (PR #30~#36)
- **PKI 인프라**: 사내 V2G PKI (`pvpentech.co.kr`) — 단계 1
- **근거**: `documents/design_guide/csms_pnc_implementation_spec_2026-05-11.md`

본 가이드는 CSMS 가 이미 운영 중인 상태에서 운영자가 **ISO 15118 Plug & Charge (PnC) 기능을 켜고 일상 운영을 수행하기 위한 절차**를 정리합니다. 신규 코드 배포 또는 PKI 인프라 신규 구축 절차는 다루지 않습니다.

---

## 목차

1. [PnC 가 무엇이고 우리가 무엇을 제공하는가](#1-pnc-가-무엇이고-우리가-무엇을-제공하는가)
2. [사전 조건 점검](#2-사전-조건-점검)
3. [PnC 활성화 절차 (첫 충전기 도입)](#3-pnc-활성화-절차-첫-충전기-도입)
4. [충전 1회 동안의 자동 흐름](#4-충전-1회-동안의-자동-흐름)
5. [일상 운영 — 모니터링 / 만료 대응 / 인증서 관리](#5-일상-운영--모니터링--만료-대응--인증서-관리)
6. [트러블슈팅](#6-트러블슈팅)
7. [CS 포털 UI 사용법](#7-cs-포털-ui-사용법)
8. [REST API 레퍼런스 (curl 모음)](#8-rest-api-레퍼런스-curl-모음)
9. [단계 2 (공공 V2G PKI) 전환 절차](#9-단계-2-공공-v2g-pki-전환-절차)
10. [부록](#10-부록)

---

## 1. PnC 가 무엇이고 우리가 무엇을 제공하는가

### 1.1 한 줄 요약

**EV 와 충전기가 케이블만 연결하면 사람의 카드 태깅 없이 인증·과금이 자동으로 이루어지는 ISO 15118 표준**. CSMS 는 충전기가 보내는 인증 메시지를 사내 V2G PKI 와 중계해 인증서·OCSP 결과를 처리.

### 1.2 Pvpentech 가 구현한 범위 (단계 1)

| 영역 | 동작 |
|---|---|
| 사내 V2G PKI 연동 | `pvpentech.co.kr/pki/15118-2/*` REST 호출 (EVSE Leaf 발급·폐기, Contract Cert 조회) + `pvpentech.co.kr/ocsp/{cpo,oem,mo,cps}` OCSP relay |
| OCPP DataTransfer 라우팅 | `vendorId="org.openchargealliance.iso15118pnc"` 9개 메시지 라우팅 |
| 자동 PnC 활성화 | 충전기 BootNotification 직후 5개 OCPP config 키 자동 `ChangeConfiguration` 푸시 (24h cooldown) |
| 자동 인증서 갱신 | 24h cron 으로 만료 임박 cert 검출 후 자동 `TriggerMessage` 발행 |
| 감사 추적 | 모든 PnC 이벤트 12개 카테고리를 `pnc_audit_log` 에 append-only 저장 (3년 권장 보존) |
| 운영자 UI | CS 포털 좌측 메뉴 **"PnC 운영"** — 개요 / 인증서 인벤토리 / CSR 진행 / 감사 로그 4 탭 |

### 1.3 Pvpentech 가 직접 처리하지 않는 것

- 사내 V2G PKI 인프라 자체 운영 — 별도 팀 (pvpentech.co.kr)
- 충전기(CP) 측 EXI / TLS 처리 — 시뮬레이터팀
- EV(EVCC) 측 인증서·서명 — Keysight 시뮬레이터 또는 실차

---

## 2. 사전 조건 점검

PnC 운영 시작 전에 다음 6가지를 모두 확인합니다.

### 2.1 환경변수 5개가 `.env` 에 있는지

CSMS VM 에서:

```bash
ssh jeong@pvpentech-vm
grep -E '^(PKI_|OCSP_|PNC_)' ~/pvpentech/.env
```

다음 5개가 모두 표시되어야 합니다 (값은 환경마다 다름):

```env
PKI_BASE_URL=https://pvpentech.co.kr/pki/15118-2
OCSP_BASE_URL=https://pvpentech.co.kr/ocsp
PKI_API_ID=gre-csms-2026
PKI_API_KEY=<32-byte hex 시크릿>
PNC_ENABLED_DEFAULT=true
PNC_TRIGGER_RENEWAL_DAYS=30
```

> `PKI_API_KEY` 가 비어있으면 모든 PKI 호출이 `PKI_DISABLED` 에러로 거부됩니다. 키는 PKI 운영팀이 별도 채널로 전달 (`pvpentech.co.kr:/home/pki/pki-wrapper/api-key.env`).

### 2.2 PKI 헬스 체크

운영자 JWT 발급:

```bash
export CS_JWT=$(curl -sX POST https://csms.pvpentech.com/api/portal/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<관리자_PW>"}' | jq -r .token)
```

PnC 헬스 호출:

```bash
curl -sH "Authorization: Bearer $CS_JWT" \
  https://csms.pvpentech.com/api/portal/cs/pnc/health | jq
```

기대 출력:

```json
{
  "success": true,
  "data": {
    "csms": {
      "pkiBaseUrl": "https://pvpentech.co.kr/pki/15118-2",
      "ocspBaseUrl": "https://pvpentech.co.kr/ocsp",
      "pkiApiId": "gre-csms-2026",
      "pkiEnabled": true,
      "pncEnabledDefault": true,
      "triggerRenewalDays": 30,
      ...
    },
    "pkiHealth": {
      "ok": true,
      "status": 200,
      "body": { "status": "ok", "service": "gre-v2g-pki-wrapper" }
    }
  }
}
```

`pkiEnabled:true` + `pkiHealth.ok:true` 가 보이면 통과. 둘 중 하나라도 실패면 §6.1 (PKI 도달 실패) 참고.

### 2.3 부팅 로그 확인

`pm2 logs pvpentech-csms` 출력 끝에서 다음 라인이 보여야 합니다 (재시작 직후):

```
"msg":"ISO 15118 PnC config loaded","pkiEnabled":true,...
"msg":"PnC DataTransfer handlers registered","vendorId":"org.openchargealliance.iso15118pnc","handlers":4
"msg":"PnC cert expiry scheduler started","intervalMs":86400000
```

세 줄 모두 있어야 PnC 가 실행 중입니다.

### 2.4 사내 PKI OCSP responder 직접 검증 (선택)

```bash
ssh -i ~/.ssh/gre-web.pem ubuntu@pvpentech.co.kr 'curl -fsS http://localhost/ocsp/cpo -X POST -H "Content-Type: application/ocsp-request" --data-binary @-' < /dev/null
```

응답이 빈 200 또는 RFC 6960 형식의 DER 바이너리이면 OK.

### 2.5 시뮬레이터 (또는 실 충전기) 측 PnC 지원 여부

충전기 펌웨어가 PnC 7개 config 키를 인식해야 합니다 (스펙 §7):

- `ISO15118PnCEnabled`
- `ContractValidationOffline`
- `CentralContractValidationAllowed`
- `CertSigningWaitMinimum`
- `CertSigningRepeatTimes`
- `CertificateSignedMaxChainSize` (정보)
- `CertificateStoreMaxLength` (정보)

확인 방법은 §3.2 (자동 sync 결과 확인).

### 2.6 DB 스키마 4개 테이블 존재

```bash
sudo -u postgres psql pvpentech -c \
  "\dt pnc_*"
```

다음 4개가 보여야 합니다:

- `pnc_installed_certificate`
- `pnc_csr_in_progress`
- `pnc_audit_log`
- (참고: 마이그레이션 후 추가됨)

---

## 3. PnC 활성화 절차 (첫 충전기 도입)

### 3.1 사전 준비

신규 PnC 지원 충전기를 현장에 설치하기 전에:

1. **EVSE ID 결정** — Pvpentech 의 `stationId` 와 동일하게 사용 (예: `EN9001234`)
2. **시리얼번호 사전 등록** — CS 포털 → "프로비저닝" 메뉴에서 일반 충전기와 동일하게 등록
3. **제조사 토큰 (x-channel/x-token)** — "제조사 관리" 메뉴에서 채널 등록 + 토큰 발급 (PnC 무관, 기존 v2.0 프로비저닝 절차)

### 3.2 충전기 첫 부팅 후 검증

충전기가 OCPP WebSocket 연결 + BootNotification 송신하면 **CSMS 가 자동으로 5개 PnC config 키를 `ChangeConfiguration` 으로 푸시**합니다 (스펙 §7, 24h 인메모리 cooldown 적용).

검증:

```bash
# 1) BootNotification 직후 5~10초 뒤 pm2 로그
pm2 logs pvpentech-csms --lines 30 | grep syncPncConfig
# 기대: "syncPncConfig: completed","applied":5,"failed":0

# 2) audit 확인
curl -sH "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/audit?eventType=PnC_ConfigChange&stationId=EN9001234" | jq
# 기대: 5개 키별로 PnC_ConfigChange status=Accepted 이벤트
```

**`applied=5` 또는 audit 5개 Accepted 면 충전기가 PnC 를 지원하는 것**. failed 가 있으면:
- 충전기 펌웨어가 그 키를 모름 → `NotSupported` (정상, 그 키는 무시됨)
- 형식 오류 → `Rejected`

### 3.3 수동 재동기화 (필요 시)

cooldown 24h 안에 강제 재시도하려면:

```bash
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/sync-config/EN9001234?force=true" | jq
```

또는 CS 포털 → "PnC 운영" → 개요 탭 (cooldown 직접 호출 UI 는 미제공, curl 또는 백엔드 호출 권장).

### 3.4 첫 EVSE Leaf 인증서 발급

PnC 동작에는 충전기마다 사내 PKI 가 서명한 **EVSE Leaf 인증서**가 필요합니다. 두 가지 발급 경로:

#### 경로 A — 충전기가 자율적으로 발급 (권장)

충전기 펌웨어가 PnC 첫 구동 시 자체적으로 CSR 을 생성해 CSMS 에 `SignCertificate.req` 송신. CSMS 는:

1. CSR PEM 형식 검증
2. 즉시 `Accepted` 응답 (스펙 §4.2 timeout 회피)
3. 비동기로 사내 PKI 에 `signEvseLeafCert(csr)` 호출
4. 응답 받은 leafCert + chain 을 `CertificateSigned.req` 로 충전기에 송신
5. 충전기가 Accepted 응답하면 완료

운영자 액션 불필요. CS 포털 → "PnC 운영" → **"CSR 진행"** 탭에서 자동 진행을 모니터링.

#### 경로 B — 운영자가 `TriggerMessage` 로 명시 트리거

충전기가 자체 CSR 송신을 안 시작하는 경우:

**CS 포털**: "PnC 운영" → "인증서 인벤토리" 탭 → 해당 충전기 row 의 **"TriggerMessage"** 버튼 클릭.

**curl**:
```bash
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/trigger/EN9001234" | jq
# 기대: {"ok":true,"status":"Accepted"}
```

충전기가 Accepted 받으면 곧 새 CSR 송신 → 경로 A 와 동일한 흐름으로 진행.

### 3.5 V2G Root CA 푸시 (선택)

충전기에 V2G Root CA 가 없거나 회전이 필요한 경우:

```bash
# V2G Root PEM 을 사내 PKI 운영팀에서 사전에 얻음
V2G_ROOT_PEM=$(cat /tmp/v2g-root.pem)

curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"certificateType\":\"V2GRootCertificate\",\"certificate\":$(jq -Rs . <<< "$V2G_ROOT_PEM")}" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/install-root/EN9001234" | jq
```

`MORootCertificate` 도 동일 방식. 충전기 측 `CertificateStoreMaxLength` (기본 10) 초과 시 거부.

---

## 4. 충전 1회 동안의 자동 흐름

PnC 가 활성화된 충전기에 PnC 지원 EV 가 연결되면 다음 흐름이 **CSMS 운영자 개입 없이 자동 진행**됩니다.

```
1. EV가 케이블 연결 → ISO 15118-2 핸드셰이크
2. CP가 EVCC 에서 받은 contract cert 정보로 CSMS 에 PnC Authorize.req 송신
   ┗ DataTransfer { vendorId, messageId:"Authorize", data:{idToken:<eMAID>, iso15118CertificateHashData:[...] } }
3. CSMS:
   a. eMAID 를 IdToken 테이블에서 조회 → 상태 매핑
   b. iso15118CertificateHashData 각 항목을 OCSP responder 에 RFC 6960 query
   c. 결과 종합해 응답 { certificateStatus, idTokenInfo.status }
4. CP가 인증 결과에 따라 StartTransaction (정상 시) 또는 거부

(이후는 일반 OCPP 1.6 충전 흐름과 동일)
```

운영자 모니터링:
- CS 포털 → "PnC 운영" → **"감사 로그"** 탭에서 실시간 PnC 이벤트 추적
- `PnC_Authorize` 이벤트의 `status` 컬럼:
  - `Accepted` — 정상
  - `CertificateExpired` — cert 만료
  - `CertificateRevoked` — cert 폐기됨 (CRL/OCSP revoked)
  - `NoCertificateAvailable` — OCSP 실패 또는 hash data 없음
  - `ContractCancelled` — eMAID 가 Blocked

---

## 5. 일상 운영 — 모니터링 / 만료 대응 / 인증서 관리

### 5.1 매일 확인할 것 (5분)

CS 포털 → **"PnC 운영"** 메뉴 → 4탭 순회:

| 탭 | 확인 항목 |
|---|---|
| 개요 | `PKI Enabled = ●` (초록) / 헬스 도달 가능 = ● / 응답 `{"status":"ok"}` |
| 인증서 인벤토리 | 빨강 행 (만료 ≤7일 또는 이미 만료) 가 있는지 |
| CSR 진행 | `failed` / `rejected` status 행이 있는지 |
| 감사 로그 | 최근 24h 의 PnC_Authorize / PnC_PKI_Call 의 status 분포 |

### 5.2 만료 모니터링 동작 원리

- **부팅 5분 후** + 이후 **24시간마다** cron 자동 실행
- 검사 대상: `pnc_installed_certificate.notAfter <= now + 60일` AND `revokedAt IS NULL` AND `certificateType='EVSELeaf'`
- 액션 (잔여 일수별):

| 잔여 일수 | 동작 |
|---|---|
| > 60일 | 무시 (검사 대상 외) |
| 31 ~ 60일 | `info` 로그만 |
| 8 ~ 30일 | **자동 `TriggerMessage` 발행** (충전기가 새 CSR 송신 유도) |
| 1 ~ 7일 | WARNING 로그 + `TriggerMessage` 발행 |
| 0일 이하 (만료) | ERROR 로그 + 마지막 `TriggerMessage` 시도 |

> 같은 station 에 leaf 가 여러 장 있어도 1회만 trigger (중복 방지). 충전기 오프라인이면 audit 에 `skipped` 기록.

### 5.3 만료 임박 cert 가 발견되면 (운영자 액션)

자동 cron 이 trigger 를 시도하지만, 충전기가 오프라인이거나 trigger 송신 후에도 새 CSR 이 안 오면 운영자 개입 필요:

1. CS 포털 → "PnC 운영" → "인증서 인벤토리" 의 빨강 행 확인
2. 그 충전기의 OCPP 연결 상태 (충전기 관리 메뉴) 확인
3. 오프라인이면 현장 점검 (네트워크 / 전원 / 펌웨어)
4. 온라인인데도 안 받으면 인벤토리 탭의 **"TriggerMessage"** 버튼 수동 클릭
5. 그래도 안 되면 §6.3 (인증서 갱신 실패) 참고

### 5.4 즉시 만료 스캔 실행

cron 대기 (최대 24h) 가 부담스러우면:

CS 포털: "PnC 운영" → 개요 → **"만료 스캔 실행"** 버튼 → "dryRun" 토글 (실 trigger 안 함, 대상만 확인용)

curl:
```bash
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/expiry-scan?dryRun=true" | jq
# items 배열의 status, daysLeft 확인
```

### 5.5 EVSE Leaf cert 폐기 (긴급 — 키 유출 의심 등)

특정 leaf 를 즉시 무효화하고 충전기에서 제거:

```bash
# 1) 사내 PKI 에 폐기 요청 (CSMS REST 통해)
# 현재는 직접 API 없음 — VM 에서 node REPL 또는 PKI 운영팀에 직접 요청
# (후속 PR 에서 운영자 API 추가 예정)

# 2) 충전기에서 제거 — DeleteCertificate
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  -H "Content-Type: application/json" \
  -d '{"certificateHashData":{"hashAlgorithm":"SHA256","issuerNameHash":"...","issuerKeyHash":"...","serialNumber":"<폐기할_serial>"}}' \
  "https://csms.pvpentech.com/api/portal/cs/pnc/delete-cert/EN9001234" | jq
```

`certificateHashData` 4개 필드는 `pnc_installed_certificate` 테이블 또는 OCSP request 페이로드에서 얻음.

---

## 6. 트러블슈팅

### 6.1 PKI 도달 실패 (`pkiHealth.ok:false`)

**증상**:
```
"pkiHealth": { "ok": false, "error": "timeout|ENOTFOUND|ECONNREFUSED" }
```

**점검 순서**:

1. CSMS VM 에서 pvpentech.co.kr 직접 ping / curl:
   ```bash
   ssh jeong@pvpentech-vm
   curl -fsS https://pvpentech.co.kr/pki-health
   ```
2. 응답이 정상이면 — env `PKI_BASE_URL` 가 올바른지 (`grep PKI_BASE ~/pvpentech/.env`)
3. 응답이 timeout 이면 — PKI 운영팀(pvpentech.co.kr 관리자)에 문의
4. SSL 오류면 — PKI 측 인증서 만료 가능성. PKI 운영팀에 문의

### 6.2 `Authorize` 가 항상 `Invalid` 반환

**증상**: 모든 EV 가 PnC Authorize 거부됨, audit 의 `details.idTokenFound = false`

**원인**: eMAID 가 `id_token` 테이블에 등록되지 않음.

**조치**:
- 단계 1 환경에선 eMAID 마스터 데이터를 별도로 등록해야 함:
  ```sql
  INSERT INTO id_token ("idTag", type, status, "expiryDate", "createdAt", "updatedAt")
  VALUES ('KRGRE0000000001', 'eMAID', 'Accepted', '2028-12-31 23:59:59', NOW(), NOW());
  ```
- 단계 2 (공공 PKI) 전환 시에는 mock CCP 대신 실제 eMAID DB 가 PKI 측에 존재 → CSMS 가 자동 동기화 (별도 작업 필요)

### 6.3 인증서 갱신 실패 (`TriggerMessage` 후에도 CSR 미수신)

**증상**: 만료 임박 cert 가 인벤토리에 그대로, audit 에 `PnC_ExpiryTrigger Accepted` 후 `PnC_SignCertificate` 이벤트가 안 옴

**원인 후보**:
1. 충전기 펌웨어가 `TriggerMessage(SignChargePointCertificate)` 를 미지원 → CP 가 Accepted 회신했지만 실제 동작 안 함
2. 충전기 측 키 페어 생성 실패 (TPM/하드웨어 issue)
3. 네트워크 끊김 (정확히 trigger 시점부터 CSR 송신까지 사이)

**조치**:
- 충전기 측 펌웨어 버전 확인 (`vendorName / firmwareVersion` 컬럼)
- 펌웨어 벤더에 PnC `TriggerMessage` 지원 여부 문의
- 임시로 `InstallCertificate(V2GRootCertificate)` 로 root 만 갱신해 시간 벌기

### 6.4 OCSP 조회가 항상 `Failed`

**증상**: `PnC_GetCertificateStatus` audit 이 `Failed` + details `phase:'post', httpStatus:4xx/5xx`

**조치**:
1. responder URL 확인 — `pnc_audit_log.details.responderURL` 컬럼
2. URL 이 `pvpentech.co.kr/ocsp/{cpo|oem|mo|cps}` 중 하나여야 함
3. 4xx 면 — request 형식 오류 (해시 알고리즘 미스매치 가능). EV/CP 측 펌웨어 검토
4. 5xx 면 — OCSP responder 측 문제 → PKI 운영팀 문의
5. timeout 이면 — `PNC_OCSP_TIMEOUT_MS` env 값 (기본 8s) 조정 검토

### 6.5 충전기가 `UnknownVendorId` 응답

**증상**: PnC `TriggerMessage` 호출 → CP 가 `outerStatus='UnknownVendorId'`

**원인**: 충전기가 `ISO15118PnCEnabled=true` 설정을 안 받았거나 펌웨어가 PnC vendor 를 모름

**조치**:
```bash
# 1) sync 강제 재시도
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/sync-config/EN9001234?force=true" | jq

# 2) 그래도 안 되면 audit 에서 어떤 키가 실패했는지 확인
sudo -u postgres psql pvpentech -c \
  "SELECT details->>'key' AS k, status FROM pnc_audit_log
   WHERE \"eventType\"='PnC_ConfigChange' AND \"stationId\"='EN9001234'
   ORDER BY id DESC LIMIT 7;"
```

`ISO15118PnCEnabled` 키 자체가 `NotSupported` 면 펌웨어가 PnC 미지원.

### 6.6 audit 로그가 폭주

**증상**: `pnc_audit_log` 행수가 일주일에 수만 건 이상

**원인**: 충전기가 BootNotification 을 자주 보냄 (재부팅 루프) → ConfigChange 5건 × 재부팅 횟수

**조치**:
- `pnc_audit_log` 직접 검사:
  ```sql
  SELECT "stationId", COUNT(*) FROM pnc_audit_log
  WHERE "occurredAt" > NOW() - INTERVAL '7 days'
  GROUP BY "stationId" ORDER BY 2 DESC LIMIT 10;
  ```
- 상위 stationId 가 재부팅 루프 의심 → 현장 점검
- 24h cooldown 이 작동 중이라 ConfigChange 는 충전기당 최대 일 1회

---

## 7. CS 포털 UI 사용법

CS 포털 → 좌측 메뉴 **"PnC 운영"** 클릭 시 4탭 페이지.

### 7.1 개요 탭

- 카드 1: **CSMS 설정** — PKI Enabled 상태, Base URL, 정책 (PNC_ENABLED_DEFAULT / TRIGGER_RENEWAL_DAYS / timeout)
- 카드 2: **PKI 헬스** — pvpentech.co.kr 도달 가능 여부, HTTP 상태, 응답 본문
- 우측 상단 **"만료 스캔 실행"** — 모달에서 dryRun 토글 후 즉시 cron 동작

### 7.2 인증서 인벤토리 탭

테이블 컬럼:
- 충전기 ID / 인증서 유형 / Serial / 만료일 / 잔여 일수 / 액션

잔여 일수 색상:
- 🔴 빨강: ≤7일 또는 이미 만료
- 🟠 주황: ≤30일 (자동 갱신 임계)
- 🟢 초록: 그 외

각 행의 **"TriggerMessage"** 버튼 — 즉시 SignCertificate 트리거 발행.

### 7.3 CSR 진행 탭

`pnc_csr_in_progress` 의 진행 상황. status 색상:
- 파랑 `pending`: PKI 호출 대기/진행 중
- 보라 `signed`: PKI 가 leaf 반환, CertificateSigned 송신 대기
- 초록 `delivered`: CP 가 받음 (성공 종료)
- 빨강 `rejected` / `failed`: 오류 (pkiErrorMessage 컬럼에 사유)

### 7.4 감사 로그 탭

모든 PnC 이벤트 12종 카테고리별 색상. details JSON 첫 80자 미리보기. 페이지네이션 50건/page.

---

## 8. REST API 레퍼런스 (curl 모음)

모든 API 는 `Authorization: Bearer $CS_JWT` 필요 (CS role).

### 8.1 헬스 / 진단

```bash
# PnC 통합 헬스 (PKI + 설정)
curl -sH "Authorization: Bearer $CS_JWT" \
  https://csms.pvpentech.com/api/portal/cs/pnc/health | jq
```

### 8.2 BootNotification config sync

```bash
# 강제 재동기화 (cooldown 무시)
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/sync-config/<STATION>?force=true"

# cooldown 초기화
curl -X DELETE -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/sync-config/<STATION>/cooldown"
```

### 8.3 만료 스캔 / TriggerMessage

```bash
# 즉시 만료 스캔 (dryRun=true 면 trigger 안 함)
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/expiry-scan?dryRun=true" | jq

# 특정 충전기에 수동 TriggerMessage
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/trigger/<STATION>" | jq
```

### 8.4 인증서·CSR·감사 조회

```bash
# 인증서 인벤토리 (만료 30일 이내만)
curl -sH "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/certificates?expiringWithinDays=30" | jq

# CSR 진행 (failed 만)
curl -sH "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/csr-progress?status=failed" | jq

# 특정 stationId 의 모든 PnC audit
curl -sH "Authorization: Bearer $CS_JWT" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/audit?stationId=<STATION>&limit=200" | jq
```

### 8.5 인증서 조작 (Root 설치 / 충전기 cert 목록 / 삭제)

```bash
# V2GRoot CA 설치
V2G_ROOT=$(jq -Rs . < /tmp/v2g-root.pem)
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"certificateType\":\"V2GRootCertificate\",\"certificate\":$V2G_ROOT}" \
  "https://csms.pvpentech.com/api/portal/cs/pnc/install-root/<STATION>" | jq

# 충전기에 설치된 cert 목록 조회 (GetInstalledCertificateIds)
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  -H "Content-Type: application/json" \
  -d '{"certificateType":["V2GRootCertificate","MORootCertificate"]}' \
  "https://csms.pvpentech.com/api/portal/cs/pnc/list-certs/<STATION>" | jq

# 충전기에서 cert 폐기
curl -sX POST -H "Authorization: Bearer $CS_JWT" \
  -H "Content-Type: application/json" \
  -d '{"certificateHashData":{"hashAlgorithm":"SHA256","issuerNameHash":"...","issuerKeyHash":"...","serialNumber":"..."}}' \
  "https://csms.pvpentech.com/api/portal/cs/pnc/delete-cert/<STATION>" | jq
```

---

## 9. 단계 2 (공공 V2G PKI) 전환 절차

한국환경공단 공공 V2G PKI 가 운영 개시되면 **CSMS 코드 변경 없이 환경변수 swap 만으로 전환**됩니다.

### 9.1 사전 조건

- 공공 PKI 운영기관에서 Pvpentech 명의의 API ID + Key 발급 완료
- VPN (AXGATE/NEXG) 구성 + dual tunnel
- 공공 OCSP responder URL 확정 (예: `http://ocsp.ev.or.kr`)

### 9.2 전환 작업 (다운타임 1~2분)

```bash
ssh jeong@pvpentech-vm
cd ~/pvpentech

# 1) 기존 env 백업
cp .env .env.bak.$(date +%F)

# 2) PnC 환경변수 4개 swap
nano .env
# PKI_BASE_URL=https://pki.ev.or.kr/pki/15118-2
# OCSP_BASE_URL=http://ocsp.ev.or.kr
# PKI_API_ID=<공공 발급 ID>
# PKI_API_KEY=<공공 발급 Key>

# 3) PM2 재시작
pm2 restart pvpentech-csms --update-env

# 4) 헬스 검증 (즉시)
curl -sH "Authorization: Bearer $CS_JWT" \
  https://csms.pvpentech.com/api/portal/cs/pnc/health | jq
# 기대: pkiBaseUrl 이 공공 URL 로 변경됨, pkiHealth.ok=true
```

### 9.3 전환 후 점검

- 기존 충전기들에 설치된 사내 V2G Root 는 그대로 유지 (충돌 없음)
- 새로 발급되는 EVSE Leaf 는 공공 V2G Sub CA 로 서명됨
- 기존 leaf 가 만료될 때까지 사내 + 공공 cert 가 공존 (정상)

### 9.4 롤백

문제 발생 시 즉시 사내 PKI 로 복원:

```bash
cp .env.bak.<날짜> .env
pm2 restart pvpentech-csms --update-env
```

---

## 10. 부록

### 10.1 PnC 감사 이벤트 12종

| eventType | 발생 시점 |
|---|---|
| `PnC_Authorize` | CP 가 PnC Authorize.req 송신 (§4.1) |
| `PnC_SignCertificate` | CP 가 CSR 제출 (§4.2 — 단계별로 여러 audit) |
| `PnC_CertificateSigned` | CSMS→CP CertificateSigned.req (§5.1) |
| `PnC_InstallCertificate` | CSMS→CP V2GRoot/MORoot 설치 (§5.2) |
| `PnC_DeleteCertificate` | CSMS→CP cert 폐기 (§5.3) |
| `PnC_GetInstalledCertIds` | CSMS→CP cert 목록 조회 (§5.4) |
| `PnC_TriggerMessage` | CSMS→CP TriggerMessage (§5.5) |
| `PnC_Get15118EVCertificate` | EV EXI 패스스루 (§4.3) |
| `PnC_GetCertificateStatus` | OCSP 조회 (§4.4) |
| `PnC_ConfigChange` | BootNotification 직후 또는 수동 sync (§7) |
| `PnC_ExpiryTrigger` | cron 또는 수동 만료 trigger (§8) |
| `PnC_PKI_Call` | 사내 PKI REST 호출 (§6, 모든 endpoint 공통) |

### 10.2 자주 쓰는 SQL

```sql
-- 만료 임박 (30일 이내) EVSE Leaf
SELECT "stationId", "serialNumber", "notAfter",
       EXTRACT(DAY FROM "notAfter" - NOW()) AS days_left
FROM pnc_installed_certificate
WHERE "certificateType" = 'EVSELeaf'
  AND "revokedAt" IS NULL
  AND "notAfter" <= NOW() + INTERVAL '30 days'
ORDER BY "notAfter";

-- 실패한 CSR (최근 7일)
SELECT "stationId", status, "pkiErrorCode", "pkiErrorMessage", "requestedAt"
FROM pnc_csr_in_progress
WHERE status IN ('failed', 'rejected')
  AND "requestedAt" > NOW() - INTERVAL '7 days'
ORDER BY "requestedAt" DESC;

-- 최근 24h 의 audit 이벤트 카운트
SELECT "eventType", status, COUNT(*)
FROM pnc_audit_log
WHERE "occurredAt" > NOW() - INTERVAL '24 hours'
GROUP BY "eventType", status
ORDER BY 1, 2;

-- 특정 충전기의 PnC 활성화 여부 검증 (5개 키 모두 Accepted 인지)
SELECT details->>'key' AS key, status, "occurredAt"
FROM pnc_audit_log
WHERE "eventType" = 'PnC_ConfigChange'
  AND "stationId" = '<STATION>'
ORDER BY "occurredAt" DESC
LIMIT 7;
```

### 10.3 환경변수 상세

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PKI_BASE_URL` | `https://pvpentech.co.kr/pki/15118-2` | 사내 V2G PKI REST base. 단계 2 전환 시 swap |
| `OCSP_BASE_URL` | `https://pvpentech.co.kr/ocsp` | OCSP responder base. 단계 2 전환 시 swap |
| `PKI_API_ID` | `gre-csms-2026` | X-Open-Api-Id 헤더 값 |
| `PKI_API_KEY` | (empty) | X-Open-Api-Key 헤더 값. 미설정 시 PKI 비활성 (mock 모드) |
| `PNC_ENABLED_DEFAULT` | `true` | 신규 충전기에 자동 sync 되는 `ISO15118PnCEnabled` 값 |
| `PNC_TRIGGER_RENEWAL_DAYS` | `30` | 자동 만료 갱신 임계 (일) |
| `PNC_PKI_TIMEOUT_MS` | `15000` | PKI REST 호출 타임아웃 |
| `PNC_OCSP_TIMEOUT_MS` | `8000` | OCSP 호출 타임아웃 |

### 10.4 관련 파일 (코드)

| 영역 | 파일 |
|---|---|
| 환경 / 상수 | `src/config/env.ts`, `src/config/pnc.ts` |
| PKI REST | `src/services/pncPki.service.ts` |
| OCSP relay + ASN.1 | `src/services/pncOcsp.service.ts`, `src/utils/asn1.ts`, `src/utils/ocspRequest.ts` |
| Config sync | `src/services/pncConfig.service.ts` (BootNotification 직후 자동) |
| 만료 모니터링 | `src/services/pncCertExpiry.service.ts`, `src/jobs/schedulers/pncCertExpiry.scheduler.ts` |
| Audit | `src/services/pncAuditLog.service.ts` |
| 송신 5종 | `src/ocpp/commands/pncSend.command.ts` |
| 수신 4 handler | `src/ocpp/handlers/pnc/{authorize,signCertificate,get15118EvCertificate,getCertificateStatus}.handler.ts` |
| 핸들러 등록 | `src/ocpp/handlers/pnc/index.ts` |
| REST API | `src/routes/portal/cs/pncOps.routes.ts` |
| 운영 UI | `public/portal/cs/index.html` (PnC 운영 탭 4종) |

### 10.5 외부 자원 위치

| 자원 | 위치 |
|---|---|
| PKI API key | `pvpentech.co.kr:/home/pki/pki-wrapper/api-key.env` (SSH: `gre-web.pem`, user `ubuntu`) |
| PKI REST endpoint | `https://pvpentech.co.kr/pki/15118-2/{cpora|cpova|ccp}/*` |
| OCSP responder | `https://pvpentech.co.kr/ocsp/{cpo|oem|mo|cps}` |
| 시뮬레이터 | `192.168.0.119` (라즈베리파이, GRE 시뮬레이터팀 관리) |

### 10.6 인계 / 문의

| 영역 | 담당 |
|---|---|
| CSMS 코드 / 운영 | Pvpentech 개발팀 |
| 사내 V2G PKI 운영 | GRE PKI팀 (pvpentech.co.kr 관리자) |
| 시뮬레이터 / SECC | GRE 시뮬레이터팀 |
| 공공 PKI 전환 (단계 2) | GRE 환경팀 + 한국환경공단 협의 |
| EVCC 통합 (Keysight) | GRE 시뮬레이터팀 |

---

## 변경 이력

- **2026-05-11**: 초안 작성. Phase A-1 ~ B-2 + UI 머지·검증 완료 기준.
