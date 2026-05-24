# CSMS PnC 구현 작업명세서

**작성일:** 2026-05-11
**대상 팀:** CSMS 개발팀
**작성:** GRE System (시뮬레이터 + PKI 운영팀)
**근거 문서:**
- OCA Application Note v1.0 (2020-09-16) "Using ISO 15118 Plug & Charge with OCPP 1.6"
- 한국 공공 V2G PKI PnC 가이드라인 V1.0 (2026-04-30)
- OCPP 2.0.1 Specification (§A 보안, §C 인증, §M 인증서 관리)

---

## 1. 작업 개요

### 1.1 목표
CSMS에 **OCPP 1.6 + ISO 15118 PnC (Plug & Charge)** 지원을 추가한다. 충전기 측 (시뮬레이터)와 차량 측 (Keysight EVCC, 추후 실차) 사이의 PnC 인증·인증서 라이프사이클을 OCPP `DataTransfer` 메시지로 중계하고, 백엔드의 V2G PKI와 연동한다.

### 1.2 단계
| 단계 | 기간 | 백엔드 | 비고 |
|---|---|---|---|
| 단계 1 | 현재 | **사내 V2G PKI** (`pvpentech.co.kr`) | 본 명세서가 대상으로 하는 단계 |
| 단계 2 | 추후 (공공 V2G Root 구축 후) | **공공 V2G PKI** (`pki.ev.or.kr`, `ocsp.ev.or.kr`) | endpoint URL과 API key swap만으로 전환 |

→ **endpoint와 인증을 모두 환경변수로 분리**해서 단계 2 전환 시 코드 수정이 발생하지 않도록 구현.

### 1.3 범위
**In scope (CSMS):**
- OCPP `DataTransfer` 메시지 라우팅 (vendorId `org.openchargealliance.iso15118pnc`)
- 9개 PnC 메시지 handler (CP↔CSMS, 양방향)
- 사내 PKI REST API 호출 (인증서 발급/조회/폐기)
- OCSP 응답 패스스루
- mock CCP (Contract Cert) 조회
- 7개 PnC config 키 관리 (ChangeConfiguration)
- 인증서 만료 모니터링·자동 갱신 트리거
- Audit log

**Out of scope (다른 팀):**
- 시뮬레이터 측 (CP) 구현 — GRE 시뮬레이터팀
- PKI 인프라 운영 — GRE PKI팀 (pvpentech.co.kr)
- 차량 측 EXI / TLS — Keysight EVCC + josev SECC (시뮬레이터팀이 통합)

---

## 2. 시스템 아키텍처

```
   EVCC (Keysight 또는 실차)
       │
       │ ISO 15118-2 (TLS 1.2, EXI, ECDSA secp256r1)
       │
       ▼
   SECC (시뮬레이터에 josev SECC 임베드)
       │
       │ OCPP 1.6 Extension (DataTransfer)
       │ wss://csms.pvpentech.com/<cpId>
       ▼
┌─────────────────────────────┐
│  CSMS (작업 대상)             │
│  - DataTransfer 라우터        │
│  - 9개 PnC handler           │
│  - PKI client (HTTPS REST)   │
│  - OCSP relay                │
│  - 만료 모니터링·trigger      │
└────────────┬────────────────┘
             │ HTTPS REST + OCSP
             ▼
   사내 V2G PKI (pvpentech.co.kr)
   - REST wrapper (FastAPI)
   - step-ca 또는 OpenSSL CA
   - OCSP responder (4 Sub CA)
   - mock CCP (eMAID DB)
```

### 2.1 통신 채널
| 채널 | 프로토콜 | 인증 |
|---|---|---|
| EVCC ↔ SECC | ISO 15118-2 over TLS 1.2 | 양측 X.509 (V2G chain) |
| SECC/시뮬레이터 ↔ CSMS | OCPP 1.6J over wss (TLS 1.2/1.3) | Basic Auth (Profile 2) |
| CSMS ↔ 사내 PKI | HTTPS REST (TLS 1.3) | `X-Open-Api-Id` + `X-Open-Api-Key` 헤더 |
| CSMS ↔ OCSP | HTTP POST (가이드라인 §2.3 명시) | 응답 자체 서명으로 무결성 |

---

## 3. OCPP DataTransfer 메시지 명세

### 3.1 DataTransfer 일반 형식
```json
[
  2,                                       // CALL
  "<msg-id-uuid>",
  "DataTransfer",
  {
    "vendorId": "org.openchargealliance.iso15118pnc",
    "messageId": "<OCPP 2.0.1 메시지명>",
    "data": "<JSON string>"                // ⚠ object 아님. JSON.stringify된 string
  }
]
```

응답:
```json
[
  3,
  "<msg-id-uuid>",
  {
    "status": "Accepted|Rejected|UnknownMessageId|UnknownVendorId",
    "data": "<JSON string>"                // status=Accepted일 때 wrapped OCPP 2.0.1 conf body
  }
]
```

### 3.2 9개 메시지 매트릭스

| # | messageId | 방향 | 책임 |
|---|---|---|---|
| 1 | `Authorize` | CP → CSMS | PnC 인증 요청. eMAID + 계약 cert OCSP/PEM 제출 |
| 2 | `SignCertificate` | CP → CSMS | CP가 새 EVSE Leaf cert CSR 제출 |
| 3 | `Get15118EVCertificate` | CP → CSMS | EV의 CertificateInstallation/Update EXI 중계 |
| 4 | `GetCertificateStatus` | CP → CSMS | 계약 cert OCSP 상태 조회 |
| 5 | `CertificateSigned` | CSMS → CP | CA에서 서명된 EVSE Leaf cert 전달 |
| 6 | `InstallCertificate` | CSMS → CP | V2G/MO Root CA 설치 |
| 7 | `DeleteCertificate` | CSMS → CP | 인증서 폐기 |
| 8 | `GetInstalledCertificateIds` | CSMS → CP | 설치된 cert 목록 조회 |
| 9 | `TriggerMessage` (wrapped) | CSMS → CP | CP가 `SignCertificate.req`를 보내도록 트리거 |

→ 각 메시지 본문은 §4·§5 상세 명세 참조.

### 3.3 응답 status 정책
| 상황 | status |
|---|---|
| CP의 `ISO15118PnCEnabled=true` 이고 vendor·messageId 모두 인식 | `Accepted` (+ `data`) |
| vendor 인식 못함 (CSMS가 PnC 미지원) | `UnknownVendorId` |
| vendor는 OK, messageId 미지원 | `UnknownMessageId` |
| 본문 형식 오류 / 서명 검증 실패 | `Rejected` |

⚠ 시뮬레이터 (CP)는 `UnknownVendorId` 응답을 받으면 `SignCertificate.req`를 **재전송 금지** (`TriggerMessage` 받기 전까지). 따라서 CSMS는 PnC를 enable한 CP에 대해 항상 `Accepted`/`Rejected` 중 적절한 status 반환.

---

## 4. CP → CSMS 메시지 (CSMS가 수신해서 처리)

### 4.1 `Authorize` (wrapped) — PnC 인증

**Request body** (data JSON string으로 wrapped):
```json
{
  "certificate": "-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----",
  "idToken": "KRGRE0000000001",
  "iso15118CertificateHashData": [
    {
      "hashAlgorithm": "SHA256",
      "issuerNameHash": "4D9A020...C6483D",
      "issuerKeyHash": "9EF251CF...53894DD3",
      "serialNumber": "2EC72CE6CB...99C01D",
      "responderURL": "https://pvpentech.co.kr/ocsp/mo"
    }
  ]
}
```

- `certificate`: optional, 계약 cert PEM. `CentralContractValidationAllowed=true` 이고 CP가 자체 검증 불가 시.
- `idToken`: required, eMAID (가이드라인 §1.4).
- `iso15118CertificateHashData`: optional, 0..4. OCSP request data로 검증.

**처리 흐름:**
1. `idToken` (eMAID)을 사내 CCP mock DB에서 조회 — 상태 확인 (ACTIVE/EXPIRED/REVOKED).
2. `iso15118CertificateHashData` 가 있으면 각 항목을 OCSP responder에 질의 (`responderURL`).
3. `certificate` 가 있으면 PEM 파싱 후 CA chain 검증 + 만료/CRL 체크.
4. eMAID 매핑 + cert 검증 결과 종합해 응답.

**Response body** (Accepted 시):
```json
{
  "certificateStatus": "Accepted",
  "idTokenInfo": {
    "status": "Accepted",
    "cacheExpiryDateTime": "2027-01-01T12:00:00.000Z"
  }
}
```

`certificateStatus` 값: `Accepted | SignatureError | CertificateExpired | CertificateRevoked | NoCertificateAvailable | CertChainError | ContractCancelled`
`idTokenInfo.status` 값: `Accepted | Blocked | ConcurrentTx | Expired | Invalid`

**검증 결과별 응답 매트릭스:**
| eMAID 상태 | cert OCSP | certificateStatus | idTokenInfo.status |
|---|---|---|---|
| ACTIVE | good | Accepted | Accepted |
| EXPIRED | — | CertificateExpired | Expired |
| REVOKED | — | CertificateRevoked | Blocked |
| ACTIVE | revoked | CertificateRevoked | Blocked |
| ACTIVE | unknown/timeout | NoCertificateAvailable | Invalid |
| 미등록 | — | — | Invalid |

---

### 4.2 `SignCertificate` — CSR 제출

**Request body:**
```json
{ "csr": "-----BEGIN CERTIFICATE REQUEST-----\nMIIBPD...\n-----END CERTIFICATE REQUEST-----" }
```

**처리 흐름:**
1. CSR 형식 검증 (PKCS#10, ECDSA P-256, signature 유효).
2. SAN URI에서 EVSE ID 추출 (예: `urn:evseid:KRGRESIM0001`).
3. 즉시 응답 `{"status":"Accepted"}` (또는 CSR 자체 오류 시 `Rejected`).
4. **비동기로** 사내 PKI에 서명 요청 (§6.1 EVSE Leaf Cert Registration API).
5. 응답 받으면 `CertificateSigned.req` 송신 (§5.1).

**Response body** (즉시):
```json
{ "status": "Accepted" }
```

`status`: `Accepted | Rejected` (GenericStatusEnumType).

**비동기 처리 정책 (가이드라인 §3.1):**
- 사내 PKI가 빨리 응답 (수 초 이내)하면 동기 처리도 가능. 단 OCPP 응답이 30초를 초과하면 CP가 timeout 처리하므로 **항상 즉시 Accepted 응답 후 별도 비동기**.
- CP는 `CertSigningWaitMinimum × 2^n` 백오프로 응답 대기. 미응답 시 `CertSigningRepeatTimes` 횟수만큼 SignCertificate.req 재전송. → CSMS는 idempotent해야 함 (같은 CSR 중복 발급 방지: 같은 CSR이면 캐시된 cert 재반환).

---

### 4.3 `Get15118EVCertificate` — EV EXI 중계

**Request body:**
```json
{
  "iso15118SchemaVersion": "urn:iso:15118:2:2013:MsgDef",
  "action": "Install",
  "exiRequest": "gAGkXyM...eHyA="
}
```

- `action`: `Install` | `Update`
- `exiRequest`: base64 인코딩된 EXI (EV가 보낸 CertificateInstallationReq 또는 CertificateUpdateReq).

**처리 흐름:**
1. `exiRequest`를 사내 CCP의 Contract Cert Inquiry API (§6.3)로 그대로 패스스루.
2. PKI 응답의 `exi` (CertificateInstallationRes/UpdateRes EXI)를 받음.
3. CP에 응답.

**Response body:**
```json
{
  "status": "Accepted",
  "exiResponse": "D4ABgWZ...D0+Pw="
}
```

`status`: `Accepted | Failed` (Iso15118EVCertificateStatusEnumType).

⚠ **EXI는 변형 금지** — 서명이 들어있으므로 어떤 변환도 가하면 EV가 거부. CSMS는 단순 pass-through.

---

### 4.4 `GetCertificateStatus` — OCSP 조회

**Request body:**
```json
{
  "ocspRequestData": {
    "hashAlgorithm": "SHA256",
    "issuerNameHash": "4D9A020...C6483D",
    "issuerKeyHash": "9EF251CF...53894DD3",
    "serialNumber": "2EC72CE6CB...99C01D",
    "responderURL": "https://pvpentech.co.kr/ocsp/mo"
  }
}
```

**처리 흐름:**
1. `responderURL`로 OCSP request 빌드 (RFC 6960).
2. POST OCSP request → OCSP response (DER) 수신.
3. DER → base64 인코딩.

**Response body:**
```json
{
  "status": "Accepted",
  "ocspResult": "MIIFIwo...K4nUc="
}
```

`status`: `Accepted | Failed` (GetCertificateStatusEnumType).
`ocspResult`: DER 인코딩 OCSPResponse를 base64. status가 Accepted 아니면 생략 가능.

---

## 5. CSMS → CP 메시지 (CSMS가 발신)

### 5.1 `CertificateSigned` — 서명된 cert 전달

**전송 시점:**
- §4.2 `SignCertificate.req` 처리 결과로 사내 PKI에서 서명된 cert를 받았을 때 (비동기).
- 또는 CSMS 운영자가 명시적으로 cert를 푸시할 때.

**Request body:**
```json
{
  "certificateChain": "-----BEGIN CERTIFICATE-----\nMIIC...LEAF...\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nMIIC...SUBCA...\n-----END CERTIFICATE-----"
}
```

- leaf cert 먼저, 그 다음 Sub CA. **V2G Root는 포함 안 함** (CP가 별도로 `InstallCertificate`로 보유).
- 총 길이는 `CertificateSignedMaxChainSize` (기본 10000) 이하.

**Expected response:**
```json
{ "status": "Accepted" }  // 또는 "Rejected"
```

CP가 `Rejected` 반환하면: 사내 PKI에 즉시 폐기 요청 (CSR 무효화) 또는 audit log에 기록.

---

### 5.2 `InstallCertificate` — Root CA 푸시

**전송 시점:**
- 신규 CP 등록 직후 (사내 V2G Root 초기 설치).
- Root 회전 시 (새 Root 푸시).

**Request body:**
```json
{
  "certificateType": "V2GRootCertificate",
  "certificate": "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----"
}
```

- `certificateType`: `V2GRootCertificate | MORootCertificate` (InstallCertificateUseEnumType).
- `certificate`: PEM 인코딩 X.509.

**Expected response:**
```json
{ "status": "Accepted" }  // Accepted | Rejected | Failed
```

CP의 `CertificateStoreMaxLength` (기본 10) 초과 시 CP가 `Rejected` 반환할 수 있음.

---

### 5.3 `DeleteCertificate` — 인증서 폐기

**Request body:**
```json
{
  "certificateHashData": {
    "hashAlgorithm": "SHA256",
    "issuerNameHash": "4D9A020...",
    "issuerKeyHash": "9EF251CF...",
    "serialNumber": "2EC72CE6CB..."
  }
}
```

**Expected response:**
```json
{ "status": "Accepted" }  // Accepted | Failed | NotFound
```

CP는 특정 cert type의 마지막 한 장이면 `Rejected` 반환 가능 (안전장치).

---

### 5.4 `GetInstalledCertificateIds` — 목록 조회

**Request body:**
```json
{ "certificateType": ["V2GRootCertificate", "MORootCertificate"] }
```

`certificateType`: 0..*, 비우면 모든 type.

**Expected response:**
```json
{
  "status": "Accepted",
  "certificateHashDataChain": [
    {
      "certificateType": "V2GRootCertificate",
      "certificateHashData": {
        "hashAlgorithm": "SHA256",
        "issuerNameHash": "...",
        "issuerKeyHash": "...",
        "serialNumber": "..."
      }
    }
  ]
}
```

---

### 5.5 `TriggerMessage` (wrapped) — SignCertificate 트리거

**전송 시점:**
- EVSE Leaf cert `notAfter` 30일 전 만료 임박 모니터링 hit.
- Sub CA 회전 시 일괄 발행.
- 운영자 수동 트리거.

**Request body:**
```json
{}
```
(가이드라인 §3.1 — 본문 비어있음. 컨텍스트는 항상 SignChargePointCertificate/SignV2GCertificate)

**Expected response:**
```json
{ "status": "Accepted" }  // Accepted | Rejected | NotImplemented
```

수신 후 CP는 새 keypair + CSR 생성 후 `SignCertificate.req` 송신 (§4.2).

---

## 6. 사내 PKI Backend 연동 (REST API)

### 6.1 EVSE Leaf Certificate 발급

**Endpoint:**
```
POST https://pvpentech.co.kr/pki/15118-2/cpo/cpora/evse-leaf-cert
```

**Headers:**
```
X-Open-Api-Id: gre-csms-2026
X-Open-Api-Key: <시크릿; 별도 전달>
Content-Type: application/json
```

**Request body:**
```json
{
  "header": {
    "traceId": "<UUID>",
    "timestamp": "2026-05-11T10:00:00Z"
  },
  "body": {
    "csr": "-----BEGIN CERTIFICATE REQUEST-----\nMIIBPD...\n-----END CERTIFICATE REQUEST-----",
    "validity": {
      "notBefore": "2026-05-11T00:00:00Z",
      "notAfter": "2028-05-11T00:00:00Z"
    }
  }
}
```

**Response (200):**
```json
{
  "header": { "traceId": "...", "timestamp": "..." },
  "body": {
    "evseId": "KRGRESIM0001",
    "leafCert": "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
    "certChain": [
      "-----BEGIN CERTIFICATE-----\nMIIC...LEAF...\n-----END CERTIFICATE-----",
      "-----BEGIN CERTIFICATE-----\nMIIC...SUBCA...\n-----END CERTIFICATE-----"
    ],
    "resultCode": "OK",
    "resultMsg": "Success"
  }
}
```

**Error responses:**
| HTTP | resultMsg |
|---|---|
| 401 | (Open API auth 실패) |
| 200 | `Error_InvalidCSR`, `Error_CSRVerificationFailed`, `Error_SigningFailure`, `Error_SubCAUnavailable`, `Error_ValidityOutOfRange` |

**검증:**
```bash
curl -X POST https://pvpentech.co.kr/pki-health
# → {"status":"ok","service":"gre-v2g-pki-wrapper"}
```

---

### 6.2 EVSE Leaf Certificate 폐기

**Endpoint:**
```
DELETE https://pvpentech.co.kr/pki/15118-2/cpo/cpova/evse-leaf-cert/revoke
```

**Request body:**
```json
{
  "header": { "traceId": "<UUID>" },
  "body": {
    "evseId": "KRGRESIM0001",
    "certificateId": "<cert SN as hex string>",
    "reason": "Private key suspected to be compromised"
  }
}
```

**Response:**
```json
{
  "header": { "traceId": "..." },
  "body": {
    "evseId": "KRGRESIM0001",
    "revocationStatus": "COMPLETED",
    "resultCode": "OK",
    "resultMsg": "Success"
  }
}
```

`revocationStatus`: `REQUEST_ACCEPTED | PROCESSING | COMPLETED | FAILED`

---

### 6.3 Contract Certificate 조회 (mock CCP)

**Endpoint:**
```
POST https://pvpentech.co.kr/pki/15118-2/cpo/ccp/contract-cert
```

**Request body:**
```json
{
  "header": { "traceId": "<UUID>" },
  "body": {
    "pcid": "PCID_GRE_TESTVEH_0001",
    "moId": "GRE",
    "exi": "<base64 EXI CertificateInstallationReq>"
  }
}
```

**Response:**
```json
{
  "header": { "traceId": "..." },
  "body": {
    "emaid": "KRGRE0000000001",
    "pcid": "PCID_GRE_TESTVEH_0001",
    "exi": "<base64 EXI CertificateInstallationRes>",
    "resultCode": "OK",
    "resultMsg": "Success"
  }
}
```

⚠ 단계 1 (사내 PKI)에서는 mock CCP라서 EXI 응답이 placeholder. 실제 서명된 EXI는 단계 2 (공공 PKI) 이후. 단계 1에서는 EXI 형식 그대로 패스스루만 검증.

---

### 6.4 OCSP responder

**Endpoint:**
```
POST http(s)://pvpentech.co.kr/ocsp/{cpo|oem|mo|cps}

(또는 추후 DNS 추가 후: http://ocsp.pvpentech.co.kr)
```

**Body:** RFC 6960 OCSP request (DER 바이너리, `Content-Type: application/ocsp-request`)

**Response:** RFC 6960 OCSP response (DER 바이너리, `Content-Type: application/ocsp-response`)

CSMS는 받은 DER을 base64 인코딩해서 §4.4 `ocspResult`에 담아 CP에 응답.

**검증:**
```bash
openssl ocsp -CAfile <v2g-root.pem> -issuer <cpo-sub.pem> \
  -cert <leaf.pem> -url https://pvpentech.co.kr/ocsp/cpo
```

---

## 7. ChangeConfiguration — PnC 활성화

CP 등록 직후 (또는 BootNotification.conf 이후) CSMS는 다음 7개 키를 자동 설정해야 한다. **하나라도 누락하면 PnC 동작 보장 불가.**

| 키 | 값 | RW/R | 비고 |
|---|---|---|---|
| `ISO15118PnCEnabled` | `true` | RW | 마스터 토글. `false`면 CP가 모든 PnC `DataTransfer.req`에 `UnknownVendorId` 응답 |
| `ContractValidationOffline` | `true` | RW | 오프라인 시 LocalAuthList/Cache로 eMAID 검증 |
| `CentralContractValidationAllowed` | `true` | RW | CP가 자체 검증 불가 시 cert PEM을 CSMS에 위임 |
| `CertSigningWaitMinimum` | `30` (초) | RW | SignCertificate 백오프 초기값 |
| `CertSigningRepeatTimes` | `3` | RW | 백오프 doubling 횟수 |
| `CertificateSignedMaxChainSize` | `10000` (byte) | R | 정보 표시용 |
| `CertificateStoreMaxLength` | `10` | R | 정보 표시용 |

**예시 CSMS → CP CALL:**
```json
[2, "msg-uuid", "ChangeConfiguration", {"key":"ISO15118PnCEnabled","value":"true"}]
```

→ 응답 `{"status":"Accepted"}` 확인 후 다음 키 설정.

---

## 8. 인증서 만료 모니터링

### 8.1 모니터링 대상
- 각 CP의 EVSE Leaf cert `notAfter` (DB 또는 `GetInstalledCertificateIds.req`로 주기 조회).
- Sub CA `notAfter` (사내 PKI 측에서 별도 alert).

### 8.2 액션 트리거
| 잔여 일수 | 액션 |
|---|---|
| `<= 60일` | INFO log, 운영자 알림 |
| `<= 30일` | wrapped `TriggerMessage` 발행 → CP가 새 CSR 송신 |
| `<= 7일` | WARNING alert, 재시도 (이전 trigger 실패 시) |
| `< 0` (만료) | ERROR alert, CP의 TLS handshake 실패 예상 |

### 8.3 구현 권장
- 일 1회 cron job 또는 백그라운드 task가 cert inventory 스캔
- Prometheus metric: `pnc_cert_days_until_expiry{cp_id="..."}` (Grafana alert)

---

## 9. Audit Log 요구사항

다음 이벤트는 모두 tamper-evident log로 보존 (append-only):

| 이벤트 | 기록 항목 |
|---|---|
| PnC `Authorize` 요청 | cp_id, eMAID, cert serial, OCSP 결과, 응답 status, timestamp |
| `SignCertificate` 요청·응답 | cp_id, CSR SAN, 발급 cert serial, PKI 호출 latency |
| `CertificateSigned` 송신 | cp_id, chain, CP 응답 status |
| `InstallCertificate` / `DeleteCertificate` | cp_id, certificateType, hash, 결과 |
| `GetCertificateStatus` | cp_id, OCSP responder URL, 결과 |
| ChangeConfiguration (PnC 키) | cp_id, key, old/new value |
| 만료 trigger 발행 | cp_id, cert serial, 잔여 일수 |

**보존 기간:** 최소 3년 권장 (감사·법적 분쟁 대응).

---

## 10. 인증·시크릿 관리

### 10.1 사내 PKI API 인증
- `X-Open-Api-Id: gre-csms-2026`
- `X-Open-Api-Key`: 32-byte hex 시크릿 — **별도 전달**
  - 현재 보관 위치: `pvpentech.co.kr:/home/pki/pki-wrapper/api-key.env` (chmod 600, pki 소유)
  - 수령: SSH로 직접 cat 또는 PKI 운영팀이 별도 안전 채널로 전달
- 환경변수로 주입 권장: `PKI_API_KEY=<key>` → 코드는 `process.env.PKI_API_KEY` 또는 `os.environ['PKI_API_KEY']` 참조
- 절대 commit/log/응답 body에 노출 금지

### 10.2 시크릿 회전 정책
- 분기 1회 회전 권장
- 회전 시 PKI 운영팀에 신키 발급 요청 → CSMS 환경변수 swap → 구키 24시간 후 무효화

### 10.3 환경변수 명세
```env
# 사내 PKI (단계 1)
PKI_BASE_URL=https://pvpentech.co.kr/pki/15118-2
OCSP_BASE_URL=https://pvpentech.co.kr/ocsp
PKI_API_ID=gre-csms-2026
PKI_API_KEY=<32-byte hex secret>

# PnC 활성화 정책
PNC_ENABLED_DEFAULT=true     # 신규 CP에 ISO15118PnCEnabled=true 자동 설정
PNC_TRIGGER_RENEWAL_DAYS=30  # 만료 N일 전 TriggerMessage 발행
```

**단계 2 (공공 PKI) 전환 시:**
```env
PKI_BASE_URL=https://pki.ev.or.kr/pki/15118-2
OCSP_BASE_URL=http://ocsp.ev.or.kr
PKI_API_ID=<공공 발급 ID>
PKI_API_KEY=<공공 발급 Key>
# + VPN (AXGATE/NEXG) 구성 + dual tunnel
```

→ **코드 변경 없이 환경변수 swap만으로 전환되도록 구현**.

---

## 11. 테스트 / 검증 절차

### 11.1 단위 테스트 (CSMS 내부)
- DataTransfer 라우터: vendorId 일치/불일치, messageId 일치/불일치, JSON 파싱 오류
- 9개 messageId별 handler: 정상 + 음성 케이스
- PKI client mock: 200/401/4xx/5xx 응답 처리

### 11.2 통합 테스트 (CSMS ↔ 사내 PKI)
```bash
# 1) PKI health
curl https://pvpentech.co.kr/pki-health
# → {"status":"ok"}

# 2) PKI API 인증
curl -X POST https://pvpentech.co.kr/pki/15118-2/cpo/ccp/contract-cert \
  -H "X-Open-Api-Id: gre-csms-2026" \
  -H "X-Open-Api-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"header":{},"body":{"pcid":"PCID_GRE_TESTVEH_0001","moId":"GRE"}}'
# → resultCode=OK, emaid=KRGRE0000000001

# 3) EVSE Leaf 발급 (CSR 직접 생성)
openssl ecparam -name prime256v1 -genkey -noout -out /tmp/test.key
openssl req -new -sha256 -key /tmp/test.key \
  -subj "/C=KR/O=GRE System/OU=V2G PKI Test/CN=KRGRECSMS0001" \
  -addext "subjectAltName=URI:urn:evseid:KRGRECSMS0001" \
  -out /tmp/test.csr
CSR=$(jq -Rs . < /tmp/test.csr)
curl -X POST https://pvpentech.co.kr/pki/15118-2/cpo/cpora/evse-leaf-cert \
  -H "X-Open-Api-Id: gre-csms-2026" -H "X-Open-Api-Key: <key>" \
  -H "Content-Type: application/json" \
  -d "{\"header\":{},\"body\":{\"csr\":${CSR}}}"
# → resultCode=OK, leafCert + certChain
```

### 11.3 통합 테스트 (CSMS ↔ 시뮬레이터)
시뮬레이터에는 이미 Phase 0 (DataTransfer 라우터 + 5개 PnC handler skeleton)이 배포되어 있음 (라즈베리파이 `192.168.0.119`).

**테스트 시나리오:**

1. **PnC 활성화**:
```bash
# CSMS가 시뮬레이터에 ChangeConfiguration(ISO15118PnCEnabled=true) 송신
# → 시뮬레이터: Accepted
```

2. **TriggerMessage → SignCertificate 라운드트립** (Phase 1 시뮬레이터팀 작업 후 가능):
```
CSMS → CP: DataTransfer(TriggerMessage, vendorId=org.openchargealliance.iso15118pnc)
CP → CSMS: DataTransfer(SignCertificate, csr=<CSR>)
CSMS → PKI: POST /pki/15118-2/cpo/cpora/evse-leaf-cert
PKI → CSMS: leafCert + certChain
CSMS → CP: DataTransfer(CertificateSigned, certificateChain=...)
CP → CSMS: status=Accepted
```

3. **음성 케이스** (단축 만료 cert로):
   - 만료된 contract cert → `Authorize` 응답 `certificateStatus=CertificateExpired`
   - revoked contract cert → `certificateStatus=CertificateRevoked`
   - eMAID DB에 미등록 → `idTokenInfo.status=Invalid`

### 11.4 Keysight EVCC 통합 (단계 5)
시뮬레이터팀이 josev SECC를 임베드 완료한 후 진행. CSMS 측 작업은 변경 없음.

---

## 12. 시뮬레이터 측에서 이미 완료된 사항 (참고)

CSMS 개발 시 시뮬레이터 측이 다음을 이미 지원함을 가정 가능:

- `DataTransfer` 수신 라우터 (vendorId/messageId 분기) — 완료
- 5개 CSMS→CP handler skeleton (`CertificateSigned`, `InstallCertificate`, `DeleteCertificate`, `GetInstalledCertificateIds`, `TriggerMessage`) — 완료
- PnC 7개 config 키 in DEFAULT_CONFIG (기본 disabled) — 완료
- ECDSA P-256 CSR 생성 모듈 (`app/ocpp/pnc_crypto.py`) — 완료
- DB 테이블 `installed_certificates`, `csr_in_progress` — 완료

**아직 미구현 (시뮬레이터 Phase 1+):**
- CP→CSMS 송신 (`SignCertificate.req` 실제 발행)
- `CertificateSigned.req` 수신 후 cert 검증·설치
- `Authorize` wrapped 송신 (PnC 인증)
- `GetCertificateStatus` 송신
- `Get15118EVCertificate` 송신
- 백오프 루프

→ CSMS의 **CSMS→CP 메시지 (§5)** 는 시뮬레이터 Phase 1과 무관하게 **지금 바로 개발·테스트 가능**.

---

## 13. 산출물 / 인수 기준

### 13.1 코드
- [ ] OCPP DataTransfer 라우터 (vendorId 분기)
- [ ] 4개 CP→CSMS handler 구현 (§4)
- [ ] 5개 CSMS→CP 송신 함수 구현 (§5)
- [ ] 사내 PKI REST 클라이언트 (§6, 4개 endpoint)
- [ ] OCSP relay 로직 (DER ↔ base64)
- [ ] PnC 7개 config 키 자동 설정 (§7)
- [ ] 만료 모니터링 job + 자동 TriggerMessage (§8)
- [ ] Audit log (§9)

### 13.2 운영
- [ ] 환경변수 분리 (§10) — 단계 2 전환 가능 구조
- [ ] PKI API key 안전 관리
- [ ] Prometheus/Grafana metric (cert 만료, PnC handler 호출 수, OCSP latency)

### 13.3 테스트
- [ ] 단위 테스트 coverage ≥ 80%
- [ ] §11.2 통합 테스트 시나리오 통과
- [ ] 시뮬레이터 (`192.168.0.119`) 와의 §11.3 시나리오 통과

### 13.4 문서
- [ ] CSMS 운영자 가이드 (PnC 활성화 절차, 모니터링)
- [ ] 트러블슈팅 가이드 (OCSP 실패, cert 만료 미감지 등)

---

## 14. 일정 / 의존 관계

```
Phase 0 (시뮬레이터) ──── 완료
                              │
                              ▼
┌─────────────────────────────────────┐
│ CSMS Phase A (본 명세)              │
│   - DataTransfer 라우터              │
│   - CSMS→CP 5개 (§5)                │
│   - 사내 PKI 연동 (§6)              │
│   - ChangeConfiguration (§7)        │
│   - Audit log (§9)                  │
└────────────┬────────────────────────┘
             │  (시뮬레이터 Phase 1 병렬 진행)
             ▼
┌─────────────────────────────────────┐
│ CSMS Phase B                        │
│   - CP→CSMS 4개 (§4)                │
│   - 만료 모니터링 (§8)               │
└────────────┬────────────────────────┘
             ▼
   시뮬레이터 Phase 1~4 통합 테스트
             ▼
   Keysight EVCC 통합 (단계 5)
             ▼
   공공 PKI 전환 (단계 2)
```

**Phase A 예상 소요: 2~3주** (1명 풀타임 기준).
**Phase B 예상 소요: 1~2주**.

---

## 15. 연락 / 조율

- **시뮬레이터팀:** OCPP DataTransfer 형식, Phase 1+ 진행 일정
- **PKI 운영팀 (pvpentech.co.kr):** API key 발급, endpoint 변경, OCSP 이슈, 인증서 회전
- **공공 PKI 도래 시:** GRE 환경팀 (한국환경공단 협의) → endpoint·API key swap 조율

---

## 부록 A: 실제 메시지 예시 (가이드라인 §3에서 발췌)

### A.1 TriggerMessage → SignCertificate → CertificateSigned 라운드트립

```json
// 1. CSMS → CP
[2, "msg-1", "DataTransfer", {
  "vendorId": "org.openchargealliance.iso15118pnc",
  "messageId": "TriggerMessage",
  "data": "{}"
}]

// 2. CP → CSMS
[3, "msg-1", {"status": "Accepted", "data": "{\"status\":\"Accepted\"}"}]

// 3. CP → CSMS (몇 초 후, 새 CSR과 함께)
[2, "msg-2", "DataTransfer", {
  "vendorId": "org.openchargealliance.iso15118pnc",
  "messageId": "SignCertificate",
  "data": "{\"csr\":\"-----BEGIN CERTIFICATE REQUEST-----\\nMIIBP...\\n-----END CERTIFICATE REQUEST-----\"}"
}]

// 4. CSMS → CP (즉시 ACK)
[3, "msg-2", {"status": "Accepted", "data": "{\"status\":\"Accepted\"}"}]

// (CSMS가 비동기로 PKI 호출 → 결과 받음)

// 5. CSMS → CP (PKI 응답 받은 후)
[2, "msg-3", "DataTransfer", {
  "vendorId": "org.openchargealliance.iso15118pnc",
  "messageId": "CertificateSigned",
  "data": "{\"certificateChain\":\"-----BEGIN CERTIFICATE-----\\nMIIC...LEAF...\\n-----END CERTIFICATE-----\\n-----BEGIN CERTIFICATE-----\\nMIIC...SUBCA...\\n-----END CERTIFICATE-----\"}"
}]

// 6. CP → CSMS
[3, "msg-3", {"status": "Accepted", "data": "{\"status\":\"Accepted\"}"}]
```

### A.2 PnC Authorize 흐름

```json
// CP → CSMS
[2, "auth-1", "DataTransfer", {
  "vendorId": "org.openchargealliance.iso15118pnc",
  "messageId": "Authorize",
  "data": "{\"idToken\":\"KRGRE0000000001\",\"iso15118CertificateHashData\":[{\"hashAlgorithm\":\"SHA256\",\"issuerNameHash\":\"4D9A...\",\"issuerKeyHash\":\"9EF...\",\"serialNumber\":\"2EC72CE6...\",\"responderURL\":\"https://pvpentech.co.kr/ocsp/mo\"}]}"
}]

// CSMS → CP
[3, "auth-1", {
  "status": "Accepted",
  "data": "{\"certificateStatus\":\"Accepted\",\"idTokenInfo\":{\"status\":\"Accepted\",\"cacheExpiryDateTime\":\"2027-01-01T12:00:00Z\"}}"
}]
```

---

## 부록 B: 참고 자료

| 자료 | 위치 |
|---|---|
| OCA Application Note | `ref_doc/ocpp_1_6_ISO_15118_v10.pdf` |
| 한국 공공 PKI 가이드라인 | `ref_doc/공공PKI_PnC_가이드라인_V1.0_260430.pdf` |
| OCPP 2.0.1 Specification | (별도 입수) |
| 시뮬레이터 갭 분석 | `out_doc/iso15118_pnc_gap_analysis_2026-05-08.md` |
| Keysight EVCC 통합 검토 | `out_doc/keysight_evcc_integration_review_2026-05-08.md` |
| 사내 PKI 구축 절차 | `out_doc/internal_v2g_pki_execution_procedure_2026-05-11.md` |
