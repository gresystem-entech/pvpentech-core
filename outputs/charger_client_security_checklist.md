# Pvpentech CSMS 충전기 클라이언트 보안 체크리스트

---

## 문서 메타데이터

| 항목 | 내용 |
|------|------|
| **문서 제목** | Pvpentech CSMS 접속용 충전기 클라이언트 보안 요구사항 체크리스트 |
| **버전** | v1.0 |
| **작성일** | 2026-05-06 |
| **최종 검토일** | 2026-05-06 |
| **적용 대상** | 충전기 펌웨어 개발자, 충전기 제조사 HW/SW 엔지니어 |
| **운영 서버** | `pvpentech.kr` (AWS EC2, ap-southeast-1) |
| **OCPP 엔드포인트** | `wss://pvpentech.kr/ocpp/<stationId>` |
| **참조 스펙** | OCPP 1.6 J (JSON over WebSocket), RFC 8446 (TLS 1.3), RFC 5246 (TLS 1.2) |

### 목적

이 문서는 `pvpentech.kr` CSMS 서버에 접속하는 충전기(Charge Point) 클라이언트 펌웨어를 개발하거나 검증하는 엔지니어를 위한 **현장 적용 가능한 보안 체크리스트**입니다.

서버 측 TLS/보안 설정은 이미 완료되어 운영 중이므로, 충전기 클라이언트 측에서 이에 호환되는 구현을 갖추는 것이 이 문서의 핵심 목적입니다.

> **문서 구성 안내**
> - 각 섹션 끝에 **Self-check** 항목이 있습니다. 해당 섹션 구현 완료 후 체크하세요.
> - `☐` 항목은 현장 엔지니어가 직접 체크박스로 활용하세요.
> - `❌ 절대 금지` / `✅ 권장` / `⚠️ 주의` 마커를 통해 중요도를 구분합니다.

---

## 목차

1. [하드웨어 요구사항](#1-하드웨어-요구사항)
2. [TLS 라이브러리 선정](#2-tls-라이브러리-선정)
3. [TLS 프로토콜 / Cipher Suite 요구사항](#3-tls-프로토콜--cipher-suite-요구사항)
4. [인증서 검증 (Certificate Validation)](#4-인증서-검증-certificate-validation)
5. [Root CA 번들 관리](#5-root-ca-번들-관리)
6. [시간 동기화 (NTP)](#6-시간-동기화-ntp)
7. [자격증명 저장 (stationId / password)](#7-자격증명-저장-stationid--password)
8. [WebSocket / OCPP 1.6 클라이언트 보안](#8-websocket--ocpp-16-클라이언트-보안)
9. [OTA 펌웨어 업데이트 보안](#9-ota-펌웨어-업데이트-보안)
10. [네트워크 안정성 / 운영 고려사항](#10-네트워크-안정성--운영-고려사항)
11. [보안 테스트 / 검증 항목](#11-보안-테스트--검증-항목)
12. [인증 / 규제 (한국 시장)](#12-인증--규제-한국-시장)
13. [성능 / 메모리 가이드](#13-성능--메모리-가이드)
14. [사전 결정 체크리스트 (개발 착수 전)](#14-사전-결정-체크리스트-개발-착수-전)
15. [부록](#15-부록)

---

## 1. 하드웨어 요구사항

### 1.1 최소 사양 기준

TLS 1.3 + WebSocket + OCPP 1.6 동시 동작 기준의 최소 하드웨어 요구사항입니다.

| 항목 | 최소 사양 | 권장 사양 | 비고 |
|------|-----------|-----------|------|
| **RAM** | 256 KB (SRAM) | 512 KB 이상 | TLS 레코드 버퍼 16 KB + OCPP 메시지 버퍼 + OS 스택 |
| **Flash / ROM** | 512 KB | 1 MB 이상 | TLS 라이브러리 + WebSocket + OCPP + Root CA 번들 |
| **MCU 클럭** | 80 MHz | 120 MHz 이상 | ECC 연산 소프트웨어 처리 기준 |
| **네트워크 인터페이스** | LTE Cat-M1 / NB-IoT / Ethernet | LTE Cat-1 / Ethernet | Wi-Fi는 보안 설정 추가 필요 |
| **RTC** | 필수 | 배터리 백업 RTC | 인증서 만료 검증을 위한 현재 시각 필수 |
| **TRNG** | 필수 | 하드웨어 TRNG | 소프트웨어 PRNG 단독 사용 ❌ 절대 금지 |
| **암호 가속기** | 권장 | AES-GCM HW 가속 | 처리 속도 5~10배 향상 |
| **Secure Element** | 권장 | ATECC608A / SE050 | 자격증명 물리적 보호 |

### 1.2 항목별 요구사항 체크리스트

#### TRNG (하드웨어 난수 발생기)
- ☐ MCU 내장 TRNG 또는 외부 TRNG 칩 탑재 확인
- ☐ TLS 핸드셰이크의 `ClientRandom` 생성에 TRNG 소스 연결 확인
- ☐ `srand(time(0))` 등 예측 가능한 시드 기반 PRNG 단독 사용 ❌ 금지
- ☐ 엔트로피 소스가 mbedTLS/wolfSSL의 `mbedtls_entropy_add_source` 또는 등가 함수에 등록됨을 코드로 확인

> **⚠️ 주의**: LTE 모듈 내장 TLS를 사용하는 경우에도, 모듈 제조사 문서에서 TRNG 기반 난수 생성 여부를 반드시 확인하세요.

#### RTC (실시간 시계)
- ☐ RTC 칩 또는 MCU 내장 RTC 탑재 확인
- ☐ 배터리 백업 (CR2032 또는 슈퍼커패시터) 으로 전원 차단 후에도 시각 유지 확인
- ☐ 부팅 시 RTC 값이 2024년 이후임을 검사하는 코드 존재 (무효 시각 → NTP 강제 동기화)
- ☐ RTC 드리프트 보정 주기 설정 (최대 허용 오차 ±5분 이내 유지)

#### 암호 가속기
- ☐ (권장) AES-GCM 하드웨어 가속 활성화 — 소프트웨어 대비 처리량 확인
- ☐ (권장) SHA-256 하드웨어 가속 활성화
- ☐ MCU 벤더 문서에서 HAL 암호화 라이브러리와 mbedTLS/wolfSSL 연동 방법 확인

#### Secure Element
- ☐ (권장) ATECC608A, ATECC608B, SE050, OPTIGA Trust M 등 SE 칩 설계에 포함
- ☐ SE에 저장할 데이터 목록 확정: `stationId`, `password`, TLS 클라이언트 인증서(해당 시)
- ☐ SE와 MCU 간 I2C/SPI 버스 물리 보안 검토 (PCB 레이아웃 수준)

---

### Self-check — 섹션 1 하드웨어

- ☐ RAM / Flash 최소 사양 충족
- ☐ TRNG 소스 확보 및 TLS 라이브러리 연결 완료
- ☐ RTC + 배터리 백업 설계 완료
- ☐ 암호 가속기 활성화 여부 결정 완료
- ☐ Secure Element 탑재 여부 결정 완료

---

## 2. TLS 라이브러리 선정

### 2.1 임베디드 환경 주요 TLS 라이브러리 비교

| 항목 | **mbedTLS 3.x** | **wolfSSL 5.x** | **OpenSSL 3.x** |
|------|-----------------|-----------------|-----------------|
| TLS 1.3 정식 지원 버전 | **3.0.0** (2021) | **4.4.0** (2019) | **1.1.1** (2018) |
| TLS 1.2 지원 | O | O | O |
| 임베디드 적합성 | ★★★★★ | ★★★★★ | ★★☆☆☆ |
| 최소 Flash | ~60 KB (최소 빌드) | ~50 KB (최소 빌드) | ~400 KB 이상 |
| 최소 RAM | ~32 KB | ~20 KB | ~100 KB 이상 |
| 라이선스 | Apache 2.0 | GPLv2 / 상업용 | Apache 2.0 |
| FIPS 140-2/3 | 상업용 버전 | 상업용 버전 | X |
| 한국 시장 레퍼런스 | 매우 많음 | 많음 | 서버 위주 |
| Pvpentech 권장 여부 | **✅ 1순위 권장** | ✅ 대안 가능 | ⚠️ 비권장 |
| 벤더 지원 | Arm, ST, NXP 등 | 주요 MCU 벤더 | - |

> **✅ 권장**: **mbedTLS 3.x** — 가장 광범위한 MCU 벤더 지원, Apache 2.0 라이선스, 충분한 한국 시장 레퍼런스.

### 2.2 Pvpentech 호환성 기준 TLS 버전 및 Cipher Suite

#### 필수 지원 항목 (서버와 협상 가능해야 함)

**TLS 1.3 Cipher Suites (최소 1개 이상 필수):**

| Cipher Suite | 우선순위 | mbedTLS 상수 |
|---|---|---|
| `TLS_AES_128_GCM_SHA256` | 1순위 | `MBEDTLS_TLS1_3_AES_128_GCM_SHA256` |
| `TLS_AES_256_GCM_SHA384` | 2순위 | `MBEDTLS_TLS1_3_AES_256_GCM_SHA384` |
| `TLS_CHACHA20_POLY1305_SHA256` | 3순위 | `MBEDTLS_TLS1_3_CHACHA20_POLY1305_SHA256` |

**TLS 1.2 Cipher Suites (서버 인증서가 ECDSA이므로 ECDHE_ECDSA 계열 필수):**

| Cipher Suite | 우선순위 | mbedTLS 상수 |
|---|---|---|
| `TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256` | 1순위 | `MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256` |
| `TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384` | 2순위 | `MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384` |
| `TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256` | 3순위 | `MBEDTLS_TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256` |

> **⚠️ 주의**: `pvpentech.kr` 서버 인증서는 **ECDSA 256-bit**입니다. `ECDHE_RSA_*` 계열 cipher suite만 구현된 경우 handshake에서 cipher suite 협상 실패가 발생합니다. **`ECDHE_ECDSA_*` 계열이 반드시 포함**되어야 합니다.

### 2.3 LTE 모듈 내장 TLS 사용 시 주의사항

LTE 모듈(Quectel EC21/EC25, SIM7600, BG96 등) 내장 TLS AT command를 사용하는 경우 반드시 아래를 확인하세요.

| 확인 항목 | 세부 내용 |
|-----------|-----------|
| **TLS 버전 설정** | AT 명령으로 TLS 1.2 이상 강제 설정 가능 여부 확인 (`AT+QSSLCFG="sslversion"` 등) |
| **Cipher Suite 설정** | ECDHE_ECDSA 계열 지원 여부 및 설정 명령 확인 |
| **CA 인증서 업로드** | 모듈 파일시스템에 Root CA PEM 업로드 방법 확인 (`AT+QFUPL` 등) |
| **인증서 검증 활성화** | 검증 레벨 설정 (`AT+QSSLCFG="seclevel",2` — 필수 인증서 검증) |
| **TLS 1.0/1.1 비활성화** | 모듈 펌웨어 버전에 따라 디폴트 활성화될 수 있으므로 명시적 비활성화 |
| **WebSocket 지원** | 일부 모듈은 WebSocket AT command 미지원 → MCU에서 직접 WebSocket 구현 필요 |
| **모듈 펌웨어 버전** | TLS 1.3 지원 여부는 모듈 펌웨어 버전에 따라 다름 (벤더 릴리즈 노트 확인 필수) |

```c
/* LTE 모듈 TLS 설정 예시 (Quectel 계열 AT commands) */
/* SSL 컨텍스트 0번, TLS 1.2 이상 강제 */
AT+QSSLCFG="sslversion",0,3      /* 3 = TLS 1.2 이상 */
/* 인증서 검증 레벨: 서버 인증서 검증 필수 */
AT+QSSLCFG="seclevel",0,2        /* 2 = 서버 인증서 검증 */
/* CA 인증서 경로 설정 */
AT+QSSLCFG="cacert",0,"UFS:isrg_root_x1.pem"
/* SNI 설정 (필수) */
AT+QSSLCFG="sni",0,1
```

---

### Self-check — 섹션 2 TLS 라이브러리

- ☐ TLS 라이브러리 선정 완료 (mbedTLS 3.x 또는 동등 수준)
- ☐ 선정 라이브러리의 TLS 1.3 지원 버전 확인 완료
- ☐ ECDHE_ECDSA cipher suite 지원 확인 완료
- ☐ LTE 모듈 내장 TLS 사용 시 ECDSA 인증서 검증 지원 여부 확인 완료
- ☐ 라이브러리 라이선스가 제품 배포 조건에 적합함을 법무 검토 완료

---

## 3. TLS 프로토콜 / Cipher Suite 요구사항

### 3.1 프로토콜 버전 정책

| TLS 버전 | 정책 | 이유 |
|----------|------|------|
| TLS 1.3 | ✅ 반드시 지원 | 성능 향상 (1-RTT), 보안 강화, 서버 지원 |
| TLS 1.2 | ✅ 반드시 지원 | 일부 레거시 네트워크 환경 호환성 |
| TLS 1.1 | ❌ 비활성화 강제 | 서버에서 차단, POODLE 등 취약점 |
| TLS 1.0 | ❌ 비활성화 강제 | 서버에서 차단, BEAST 취약점 |
| SSL 3.0 이하 | ❌ 절대 비활성화 | POODLE, 수십 년 전 취약점 |

```c
/* mbedTLS: TLS 1.2 최솟값 설정 예시 */
mbedtls_ssl_conf_min_version(&conf,
    MBEDTLS_SSL_MAJOR_VERSION_3,
    MBEDTLS_SSL_MINOR_VERSION_3);  /* 3.3 = TLS 1.2 */

/* wolfSSL: TLS 1.2 최솟값 설정 예시 */
wolfSSL_CTX_SetMinVersion(ctx, WOLFSSL_TLSV1_2);
```

### 3.2 활성화 / 비활성화 Cipher Suite 목록

#### 활성화 (Pvpentech 서버와 호환되는 Cipher)

```
TLS 1.3:
  TLS_AES_128_GCM_SHA256
  TLS_AES_256_GCM_SHA384
  TLS_CHACHA20_POLY1305_SHA256

TLS 1.2 (ECDHE_ECDSA 계열만):
  TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
  TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384
  TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256
```

#### 비활성화 (반드시 제거 또는 비활성화)

| 카테고리 | Cipher Suite / 항목 | 이유 |
|----------|---------------------|------|
| 스트림 암호 | `RC4-*` 전체 | RC4 통계적 편향, RFC 7465로 금지 |
| 블록 암호 레거시 | `*3DES*`, `*DES*` | 64-bit 블록 SWEET32 취약점 |
| CBC 모드 | `*_WITH_AES_*_CBC_*` (TLS 1.2) | BEAST, Lucky13, POODLE(TLS) 취약점 |
| NULL 암호화 | `TLS_NULL_*`, `*_NULL_*` | 암호화 없음 — 절대 금지 |
| 익명 키 교환 | `TLS_DH_anon_*`, `TLS_ECDH_anon_*` | 서버 인증 없음 — MitM 취약 |
| Export 등급 | `*_EXPORT_*` | 40/56-bit 취약 키 |
| 정적 RSA | `TLS_RSA_*` (키 교환에 RSA 직접) | Forward Secrecy 없음 |
| 정적 ECDH | `TLS_ECDH_ECDSA_*`, `TLS_ECDH_RSA_*` | Forward Secrecy 없음 |
| MD5 / SHA1 기반 MAC | `*_MD5`, `*_SHA` (SHA1) | 충돌 취약점 |

```c
/* mbedTLS: 허용 cipher suite 명시적 지정 예시 (화이트리스트 방식) */
static const int allowed_ciphersuites[] = {
    /* TLS 1.2 */
    MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
    MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
    MBEDTLS_TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
    0  /* 종료 표시 */
};
mbedtls_ssl_conf_ciphersuites(&conf, allowed_ciphersuites);
/* TLS 1.3 cipher suite는 별도 config.h 매크로로 제어 */
```

### 3.3 필수 ECC 곡선 (Elliptic Curves)

| 곡선 | 상태 | 이유 |
|------|------|------|
| `secp256r1` (P-256) | ✅ 필수 지원 | ISRG Root X1 및 E7 중간 CA 인증서의 키 곡선 |
| `x25519` | ✅ 필수 지원 | TLS 1.3 키 교환 (ECDHE) 기본값 |
| `secp384r1` (P-384) | ✅ 권장 지원 | AES-256-GCM과 보안 강도 일치 |
| `secp521r1` (P-521) | 선택 | 과도한 연산, 임베디드 환경에서 지양 |
| `brainpool*` | ⚠️ 비권장 | 서버 비지원, 상호 운용성 낮음 |

```c
/* mbedTLS: 허용 ECC 곡선 설정 */
static const mbedtls_ecp_group_id allowed_curves[] = {
    MBEDTLS_ECP_DP_SECP256R1,
    MBEDTLS_ECP_DP_CURVE25519,  /* x25519 */
    MBEDTLS_ECP_DP_SECP384R1,
    MBEDTLS_ECP_DP_NONE         /* 종료 표시 */
};
mbedtls_ssl_conf_curves(&conf, allowed_curves);
```

### 3.4 필수 서명 알고리즘

| 서명 알고리즘 | 상태 | 비고 |
|---|---|---|
| `ecdsa_secp256r1_sha256` | ✅ 필수 | 서버 인증서 서명 알고리즘 |
| `ecdsa_secp384r1_sha384` | ✅ 권장 | |
| `rsa_pss_rsae_sha256` | ✅ 권장 | 일부 중간 CA 체인 호환성 |
| `rsa_pkcs1_sha256` | 허용 | 레거시 호환 |
| `*_sha1` 계열 | ❌ 비활성화 | SHA1 충돌 취약점, NIST 권고 폐기 |
| `*_md5` 계열 | ❌ 절대 비활성화 | MD5 충돌 실증됨 |

---

### Self-check — 섹션 3 TLS 프로토콜

- ☐ TLS 1.2 / 1.3만 활성화, TLS 1.0/1.1/SSL 비활성화 코드 확인
- ☐ ECDHE_ECDSA cipher suite 화이트리스트 방식으로 설정
- ☐ RC4, 3DES, NULL, CBC-mode 등 취약 cipher 비활성화 확인
- ☐ secp256r1 + x25519 ECC 곡선 지원 확인
- ☐ SHA1/MD5 서명 알고리즘 비활성화 확인

---

## 4. 인증서 검증 (Certificate Validation)

> **이 섹션은 전체 문서에서 가장 중요합니다.** 인증서 검증을 생략하거나 약화시키면 중간자 공격(MitM)으로 충전기가 가짜 서버에 연결되어 충전 데이터 조작, 자격증명 탈취가 가능해집니다.

### 4.1 검증 항목 필수 체크리스트

#### Root CA 검증

- ☐ 신뢰할 수 있는 Root CA 번들을 펌웨어에 내장
- ☐ `pvpentech.kr` 인증서 발급 Root CA: **ISRG Root X1** (Let's Encrypt)
- ☐ ISRG Root X1 + **ISRG Root X2** 모두 번들에 포함 (Let's Encrypt는 교차 서명 구조 사용)
- ☐ 서버 인증서 체인을 Root CA까지 완전히 검증
- ☐ 신뢰 앵커(trust anchor)로 시스템 CA 스토어 단독 사용 ⚠️ 주의 — 임베디드 환경에서는 직접 관리 필수

#### 인증서 체인 검증

- ☐ 서버가 제공하는 전체 인증서 체인(Leaf → Intermediate → Root) 검증
- ☐ 현재 체인 구조: `pvpentech.kr Leaf` → `E7 (ISRG Intermediate)` → `ISRG Root X1`
- ☐ 중간 CA(E7) 인증서를 서버가 제공하지 않는 경우를 대비한 처리 로직 (AIA 또는 번들 포함)
- ☐ 체인 최대 깊이(max depth) 설정 — 너무 낮으면 정상 체인 거부, 너무 높으면 공격 가능 (권장: 4~5)

```c
/* mbedTLS: 인증서 검증 설정 */
mbedtls_ssl_conf_authmode(&conf, MBEDTLS_SSL_VERIFY_REQUIRED);
/* ❌ 절대 금지: MBEDTLS_SSL_VERIFY_NONE */

/* Root CA 인증서 로드 */
mbedtls_x509_crt_init(&ca_cert);
ret = mbedtls_x509_crt_parse(&ca_cert,
    (const unsigned char *)isrg_root_x1_pem,
    isrg_root_x1_pem_len);
if (ret != 0) {
    /* CA 인증서 로드 실패 — 연결 시도 금지 */
    handle_fatal_error();
}
mbedtls_ssl_conf_ca_chain(&conf, &ca_cert, NULL);
```

#### 유효기간 검증

- ☐ 현재 시각 기준 인증서 `notBefore` 이전이면 거부
- ☐ 현재 시각 기준 인증서 `notAfter` 이후이면 거부
- ☐ Let's Encrypt 인증서 유효기간: **90일** — 서버 측에서 자동 갱신하므로 클라이언트는 시간 동기화만 유지하면 됨
- ☐ 시스템 시각이 신뢰할 수 없는 경우(RTC 미초기화 등) TLS 연결 시도 전 NTP 동기화 강제

```c
/* mbedTLS: 유효기간 검증은 VERIFY_REQUIRED 설정 시 자동 수행 */
/* 검증 결과 플래그 확인 예시 */
uint32_t verify_flags;
mbedtls_ssl_get_verify_result(&ssl, &verify_flags);
if (verify_flags & MBEDTLS_X509_BADCERT_EXPIRED) {
    log_error("인증서 만료");
}
if (verify_flags & MBEDTLS_X509_BADCERT_FUTURE) {
    log_error("인증서 유효기간 미도래 (RTC 오류 가능성)");
}
```

#### 도메인(SAN) 일치 검증

- ☐ 서버 인증서의 Subject Alternative Name (SAN) 또는 Common Name이 `pvpentech.kr`과 일치하는지 검증
- ☐ SNI(Server Name Indication) 설정: TLS ClientHello에 `pvpentech.kr` 포함 — 이 값이 검증에 사용됨
- ☐ 와일드카드 인증서인 경우 (`*.pvpentech.kr`) 와일드카드 매칭 규칙 올바른지 확인
- ☐ IP 주소로 직접 접속 ⚠️ 비권장 — 도메인 기반 접속만 허용

```c
/* mbedTLS: SNI 설정 (도메인 검증의 기준이 됨) */
mbedtls_ssl_set_hostname(&ssl, "pvpentech.kr");
```

#### 서명 알고리즘 강도 검증

- ☐ SHA1 서명된 인증서 거부 (`MBEDTLS_X509_BADCERT_BAD_MD`)
- ☐ MD5 서명된 인증서 거부
- ☐ RSA 1024-bit 이하 키 거부

```c
/* mbedTLS config.h에서 약한 해시 비활성화 */
/* MBEDTLS_MD5_C 를 인증서 관련 컨텍스트에서 제거하거나
   인증서 파싱 시 MBEDTLS_X509_BADCERT_BAD_MD 플래그 확인 */
```

### 4.2 VERIFY_NONE 절대 금지

```c
/* ❌ 절대 금지 — 이 코드는 제품에 절대 들어가면 안 됨 */
mbedtls_ssl_conf_authmode(&conf, MBEDTLS_SSL_VERIFY_NONE);
/* wolfSSL의 경우 */
wolfSSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL);

/* ✅ 반드시 이렇게 */
mbedtls_ssl_conf_authmode(&conf, MBEDTLS_SSL_VERIFY_REQUIRED);
wolfSSL_CTX_set_verify(ctx, SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT, NULL);
```

> **❌ 절대 금지**: 개발 편의를 위해 `VERIFY_NONE`을 설정한 채 양산 펌웨어에 배포하는 행위. 이는 TLS를 사용하지 않는 것과 동일하며, MitM 공격에 완전히 무방비 상태가 됩니다.

### 4.3 (선택) OCSP / CRL 검증

| 방식 | 설명 | 임베디드 적합성 |
|------|------|-----------------|
| **OCSP Stapling** | 서버가 OCSP 응답을 TLS 핸드셰이크에 포함 | ✅ 추가 네트워크 불필요, 권장 |
| **OCSP 직접 조회** | 클라이언트가 OCSP 서버에 직접 HTTP 요청 | ⚠️ 추가 연결 필요, 네트워크 비용 발생 |
| **CRL 다운로드** | 인증서 폐기 목록 다운로드 | ❌ 임베디드 비권장 (파일 크기 큼) |

- ☐ (선택) OCSP Stapling 응답 처리 구현 여부 결정
- ☐ OCSP 조회 실패 시 Soft-fail(연결 허용) vs Hard-fail(연결 거부) 정책 결정

---

### Self-check — 섹션 4 인증서 검증

- ☐ `MBEDTLS_SSL_VERIFY_REQUIRED` (또는 동등 설정) 활성화 확인
- ☐ Root CA로 ISRG Root X1 + X2 로드 확인
- ☐ SNI `pvpentech.kr` 설정 확인
- ☐ 유효기간 검증 결과 플래그 처리 코드 확인
- ☐ SHA1/MD5 서명 거부 설정 확인
- ☐ VERIFY_NONE 코드 전체 소스에서 grep으로 제거 확인

---

## 5. Root CA 번들 관리

### 5.1 Root CA 번들 구성

`pvpentech.kr` 서버가 사용하는 인증서 체인 구조:

```
pvpentech.kr (Let's Encrypt ECDSA 256-bit, 유효기간 90일)
    └── E7 Intermediate CA (ECDSA, Let's Encrypt)
            └── ISRG Root X1 (RSA 4096-bit, 만료: 2030-09-30)
                    └── DST Root CA X3 (교차 서명, 2021-09-30 만료 — 신규 기기는 무시)
```

> **⚠️ 주의**: DST Root CA X3은 2021년 9월 30일 만료되었습니다. 구형 기기 일부는 이 교차 서명 체인을 따라가다 오류가 발생할 수 있습니다. 신규 기기는 **ISRG Root X1을 직접 신뢰**하도록 구성하세요.

### 5.2 필수 보유 Root CA 목록

| CA 이름 | 키 타입 | 만료일 | 필수 여부 | 다운로드 |
|---------|---------|--------|-----------|---------|
| **ISRG Root X1** | RSA 4096 | 2030-09-30 | ✅ 필수 | https://letsencrypt.org/certificates/ |
| **ISRG Root X2** | ECDSA P-384 | 2035-09-04 | ✅ 필수 | https://letsencrypt.org/certificates/ |

> ISRG Root X2는 현재 Let's Encrypt의 ECDSA 인증서 체인에서 사용됩니다. `pvpentech.kr`이 ECDSA 인증서를 사용하므로 **X2도 번들에 반드시 포함**해야 합니다.

### 5.3 Root CA 저장 방식 요구사항

#### 저장 위치

- ☐ 펌웨어 코드 바이너리(`*.c`, `*.h` 내 char 배열 하드코딩) ❌ 금지 — OTA로 갱신 불가
- ☐ 별도 파티션 또는 EEPROM 영역에 PEM/DER 형식으로 저장 ✅ 권장
- ☐ (권장) `rootca` 전용 파티션 또는 EEPROM 섹터 분리

```
펌웨어 파티션 레이아웃 예시:
┌─────────────────────────────────────────────────────────┐
│ Bootloader       (Flash 시작)                            │
├─────────────────────────────────────────────────────────┤
│ App A (Active)   (A/B 파티션)                            │
├─────────────────────────────────────────────────────────┤
│ App B (Standby)  (A/B 파티션)                            │
├─────────────────────────────────────────────────────────┤
│ Root CA Bundle   (별도 파티션, OTA로 갱신 가능)           │
├─────────────────────────────────────────────────────────┤
│ Config / NVS     (stationId, password, NTP 등)          │
└─────────────────────────────────────────────────────────┘
```

#### OTA 갱신 가능 구조

- ☐ Root CA 번들이 OTA를 통해 교체 가능한 구조로 설계
- ☐ Root CA 번들 업데이트 자체도 코드 서명 검증 후 적용
- ☐ ISRG Root X1 만료(2030-09-30) 이전에 Root CA 갱신 OTA 배포 계획 수립

> **⚠️ 주의**: ISRG Root X1은 2030년 9월 30일 만료됩니다. 2029년 말부터는 갱신된 Root CA 번들 OTA를 배포해야 합니다. Root CA를 펌웨어에 하드코딩하면 전체 펌웨어 OTA가 필요해지고 현장 기기 전수 업데이트가 필요합니다.

#### 무결성 보호

- ☐ Root CA 번들 파티션에 CRC32 또는 SHA256 해시 체크섬 저장
- ☐ 부팅 시 Root CA 번들 체크섬 검증 → 손상 감지 시 안전 모드 진입
- ☐ Root CA 번들을 갱신할 수 있는 권한은 OTA 서명 검증을 통과한 경우에만 부여

### 5.4 Root CA 다운로드 출처

- ISRG Root X1 (PEM/DER): https://letsencrypt.org/certificates/
- ISRG Root X2 (PEM/DER): https://letsencrypt.org/certificates/
- Let's Encrypt 인증서 체인 상세: https://letsencrypt.org/docs/certificate-compatibility/
- Certifi (Python/참고용 번들): https://github.com/certifi/python-certifi

---

### Self-check — 섹션 5 Root CA 번들

- ☐ ISRG Root X1 + X2 모두 번들 포함 확인
- ☐ 별도 파티션/EEPROM에 저장 (코드 하드코딩 아님) 확인
- ☐ OTA로 갱신 가능한 구조 설계 완료
- ☐ 번들 무결성 체크섬 검증 코드 구현 완료
- ☐ 2030년 Root CA 만료 대응 계획 수립 완료

---

## 6. 시간 동기화 (NTP)

### 6.1 NTP 요구사항

TLS 인증서 유효기간 검증은 클라이언트의 현재 시각에 의존합니다. 시각이 잘못된 경우 유효한 인증서가 만료된 것으로 판단되거나, 아직 유효하지 않은 인증서가 통과될 수 있습니다.

#### 부팅 시퀀스 (필수)

```
전원 ON
  └── 1. 네트워크 연결 (LTE/Ethernet 링크 확립)
  └── 2. NTP 동기화 시도 (최대 3회 재시도)
       ├── 성공: 시스템 시각 설정 → TLS 연결 허용
       └── 실패: 마지막 신뢰 저장 시각 사용 또는 연결 보류 정책 적용
  └── 3. TLS + WebSocket 연결 → OCPP BootNotification
  └── 4. BootNotification 응답의 currentTime으로 시각 재보정
```

#### 권장 NTP 서버 (한국 환경)

| NTP 서버 | 설명 | 권장도 |
|----------|------|--------|
| `pool.ntp.org` | 글로벌 NTP 풀, 가장 범용적 | ✅ 1순위 |
| `kr.pool.ntp.org` | 한국 NTP 풀 | ✅ 2순위 |
| `time.google.com` | Google Public NTP (Stratum 1) | ✅ 3순위 (백업) |
| `time.cloudflare.com` | Cloudflare NTP (Roughtime 지원) | 선택 |
| `time.nist.gov` | NIST (미국, 레이턴시 높을 수 있음) | 백업용 |

```c
/* NTP 서버 우선순위 설정 예시 */
const char *ntp_servers[] = {
    "pool.ntp.org",
    "kr.pool.ntp.org",
    "time.google.com",
    NULL
};
```

### 6.2 시간 오차 허용 범위

| 항목 | 값 |
|------|-----|
| TLS 핸드셰이크 허용 시각 오차 | ±5분 이내 권장 (RFC 5280 기준 인증서 검증) |
| OCPP Heartbeat `currentTime` 보정 허용 오차 | ±30초 이내이면 보정, 초과하면 즉시 NTP 재동기화 |
| NTP 동기화 실패 시 최대 RTC 신뢰 기간 | 최대 24시간 (배터리 백업 RTC 기준) |
| NTP 주기 동기화 간격 | 4시간마다 1회 권장 |

### 6.3 OCPP `currentTime` 보정 로직

`BootNotification` 및 `Heartbeat` 응답에는 CSMS의 `currentTime` (ISO 8601 UTC)이 포함됩니다. 이를 보조 시각 보정 소스로 활용할 수 있습니다.

```c
/* BootNotification 응답 처리 예시 */
void handle_boot_notification_response(const char *current_time_str) {
    time_t server_time = parse_iso8601_utc(current_time_str);
    time_t local_time  = get_rtc_time();
    int64_t drift_sec  = (int64_t)server_time - (int64_t)local_time;

    if (abs(drift_sec) > 30) {
        log_warn("시각 오차 %lld초 감지, OCPP currentTime으로 보정", drift_sec);
        set_rtc_time(server_time);
        /* NTP 재동기화 큐에 추가 */
        queue_ntp_sync();
    }
}
```

### 6.4 NTP 실패 시 정책

- ☐ NTP 3회 연속 실패 시 알람 이벤트 기록
- ☐ NTP 실패 상태에서 RTC 값이 2024-01-01 이전이면 TLS 연결 시도 금지 (인증서 검증 오류 확실)
- ☐ NTP 실패 상태에서 RTC 값이 합리적 범위(2024-2035)이면 연결 허용 후 `currentTime`으로 보정
- ☐ NTP 실패 이력을 OCPP `DiagnosticsStatusNotification` 또는 `DataTransfer`로 CSMS에 보고 (선택)

---

### Self-check — 섹션 6 NTP

- ☐ 부팅 시 NTP 우선 동기화 → TLS 연결 순서 구현 확인
- ☐ NTP 서버 목록 3개 이상 설정 확인
- ☐ OCPP `currentTime` 기반 시각 보정 로직 구현 확인
- ☐ NTP 실패 시 Fallback 정책 정의 및 구현 확인
- ☐ 4시간 주기 NTP 재동기화 구현 확인

---

## 7. 자격증명 저장 (stationId / password)

### 7.1 자격증명 항목

Pvpentech 프로비저닝 흐름(참조: `12_charger_provisioning.md`)에서 충전기는 아래 자격증명을 수령합니다.

| 항목 | 설명 | 민감도 |
|------|------|--------|
| `station_id` | CSMS 내 충전기 식별자 (예: `EN1000001`) | 중간 |
| `password` | OCPP Basic Auth 비밀번호 | ⚠️ 높음 |
| `csms_server` | CSMS WebSocket URL | 낮음 |

### 7.2 저장 방식별 보안 수준 비교

| 저장 방식 | 보안 수준 | 권장도 | 비고 |
|-----------|-----------|--------|------|
| 평문 Flash NVS | ❌ 매우 낮음 | ❌ 금지 | JTAG/SWD로 직접 덤프 가능 |
| 소프트웨어 암호화 후 Flash 저장 | ⚠️ 중간 | 최소 요구사항 | 암호화 키를 어디에 저장하는지가 문제 |
| TrustZone Secure World (ARM) | 높음 | ✅ 권장 | Cortex-M33/A-class MCU |
| Secure Element (ATECC608, SE050) | ✅ 매우 높음 | ✅ 1순위 권장 | 물리적 공격 방어 |
| OTP/Fuse (UID 기반 키 파생) | 높음 | ✅ 권장 (보조) | 양산 시 기기별 유일 키 생성 가능 |

### 7.3 Secure Element 활용 패턴

```
[프로비저닝 시]
  1. POST /provision → {station_id, password, csms_server}
  2. MCU가 수신
  3. password → SE의 보안 슬롯(slot 0)에 저장
     station_id, csms_server → SE의 데이터 슬롯 또는 암호화된 NVS
  4. SE는 쓰기 완료 후 해당 슬롯을 "Read-after-write" 잠금

[OCPP 연결 시]
  1. MCU가 SE에서 password 로드 (SE 외부로 평문 노출 최소화)
  2. SE 내부에서 Base64 인코딩 또는 MCU에서 인코딩
  3. Authorization 헤더 생성 → TLS 채널로 전송
```

### 7.4 ARM TrustZone / TEE 활용

- ☐ (해당 MCU 사용 시) Secure World에서 password를 관리하는 Trusted Application(TA) 구현
- ☐ Normal World에서 password 원문에 접근 불가 — Secure World를 통해서만 인증 헤더 생성
- ☐ TA는 개발사 서명으로 보호

### 7.5 소프트웨어 암호화 최소 요구사항 (SE/TrustZone 미탑재 시)

- ☐ AES-256-GCM으로 자격증명 암호화 후 NVS 저장
- ☐ 암호화 키는 MCU의 고유 UID(디바이스 ID)에서 KDF(HKDF 또는 PBKDF2)로 파생 — 기기별 유일
- ☐ 암호화 키를 평문으로 Flash에 저장 ❌ 금지

```c
/* 기기 UID 기반 키 파생 예시 (의사코드) */
uint8_t device_uid[12];  /* MCU 고유 ID (예: STM32 UID) */
HAL_GetUID((uint32_t *)device_uid);

uint8_t derived_key[32];
mbedtls_hkdf(
    mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
    NULL, 0,                    /* salt */
    device_uid, sizeof(device_uid),
    (const uint8_t *)"pvpentech-nvs-key", 18, /* info */
    derived_key, sizeof(derived_key)
);
/* derived_key로 AES-256-GCM 암호화 후 NVS에 저장 */
```

### 7.6 Factory 프로비저닝 절차 보안

- ☐ 프로비저닝 서버 통신도 TLS (HTTPS) 사용 — 단순 HTTP ❌ 금지
- ☐ 프로비저닝 완료 후 임시 자격증명은 즉시 삭제
- ☐ 프로비저닝 서버 URL 자체도 별도 파티션에 저장 (코드 하드코딩 최소화)
- ☐ 직렬 번호(`serial_number`)와 사전 공유된 시크릿으로 프로비저닝 서버 상호 인증

---

### Self-check — 섹션 7 자격증명 저장

- ☐ 평문 Flash 저장 코드 없음 확인 (전체 소스 grep)
- ☐ Secure Element 또는 TrustZone 활용 여부 결정 완료
- ☐ SE 미탑재 시 기기 UID 기반 암호화 키 파생 구현 확인
- ☐ 프로비저닝 통신 TLS 적용 확인
- ☐ 양산 라인 프로비저닝 절차 보안 검토 완료

---

## 8. WebSocket / OCPP 1.6 클라이언트 보안

### 8.1 WebSocket 연결 요구사항

#### 연결 설정 (필수 헤더)

| 헤더 | 값 | 비고 |
|------|-----|------|
| `Sec-WebSocket-Protocol` | `ocpp1.6` | ✅ 필수 — 누락 시 서버가 연결 거부 |
| `Authorization` | `Basic <base64(stationId:password)>` | ✅ 필수 — 누락 시 401 반환 |
| `Host` | `pvpentech.kr` | HTTP/1.1 필수 헤더 |

```c
/* WebSocket 업그레이드 요청 헤더 구성 예시 */
/* station_id = "EN1000001", password = "s3cr3tP@ss" */
char credentials[256];
snprintf(credentials, sizeof(credentials),
    "%s:%s", station_id, password);

/* Base64 인코딩 */
char b64_creds[512];
mbedtls_base64_encode(
    (unsigned char *)b64_creds, sizeof(b64_creds),
    &output_len,
    (const unsigned char *)credentials, strlen(credentials)
);

/* HTTP 업그레이드 요청 */
char upgrade_request[1024];
snprintf(upgrade_request, sizeof(upgrade_request),
    "GET /ocpp/%s HTTP/1.1\r\n"
    "Host: pvpentech.kr\r\n"
    "Upgrade: websocket\r\n"
    "Connection: Upgrade\r\n"
    "Sec-WebSocket-Key: %s\r\n"
    "Sec-WebSocket-Version: 13\r\n"
    "Sec-WebSocket-Protocol: ocpp1.6\r\n"
    "Authorization: Basic %s\r\n"
    "\r\n",
    station_id, ws_key_b64, b64_creds
);
```

### 8.2 연결 유지 (Keep-alive)

| 항목 | 권장값 | 이유 |
|------|--------|------|
| WebSocket Ping 전송 주기 | 60초 | OCPP HeartbeatInterval 기본값과 일치 |
| WebSocket Ping 응답 대기 시간 | 10초 | Pong 미수신 시 재연결 |
| TCP Keepalive Idle | 60초 | NAT 테이블 유지 |
| TCP Keepalive Interval | 10초 | |
| TCP Keepalive Count | 3 | 3회 실패 시 연결 종료 |

```c
/* TCP Keepalive 설정 예시 (POSIX 소켓) */
int keepalive = 1;
int keepidle  = 60;
int keepintvl = 10;
int keepcnt   = 3;
setsockopt(sockfd, SOL_SOCKET,  SO_KEEPALIVE, &keepalive, sizeof(int));
setsockopt(sockfd, IPPROTO_TCP, TCP_KEEPIDLE, &keepidle,  sizeof(int));
setsockopt(sockfd, IPPROTO_TCP, TCP_KEEPINTVL,&keepintvl, sizeof(int));
setsockopt(sockfd, IPPROTO_TCP, TCP_KEEPCNT,  &keepcnt,   sizeof(int));
```

### 8.3 자동 재연결 + Exponential Backoff

```c
/* Exponential Backoff with Jitter 구현 예시 */
#define BACKOFF_BASE_MS    1000   /* 초기 대기 시간: 1초 */
#define BACKOFF_MAX_MS    60000   /* 최대 대기 시간: 60초 */
#define BACKOFF_JITTER_MS  5000   /* 최대 jitter: 5초 */

uint32_t reconnect_attempts = 0;

uint32_t calculate_backoff_ms(uint32_t attempt) {
    uint32_t backoff = BACKOFF_BASE_MS * (1u << attempt); /* 2^n 증가 */
    if (backoff > BACKOFF_MAX_MS) backoff = BACKOFF_MAX_MS;
    /* jitter 추가: TRNG에서 난수 추출 */
    uint32_t jitter = trng_get_uint32() % BACKOFF_JITTER_MS;
    return backoff + jitter;
}

void reconnect_task(void) {
    while (1) {
        if (ws_connect() == WS_OK) {
            reconnect_attempts = 0;  /* 성공 시 초기화 */
            break;
        }
        uint32_t wait = calculate_backoff_ms(reconnect_attempts);
        log_info("재연결 대기 %u ms (시도 %u)", wait, reconnect_attempts + 1);
        delay_ms(wait);
        if (reconnect_attempts < 6) reconnect_attempts++; /* 최대 지수 제한 */
    }
}
```

### 8.4 연결 끊김 동안 메시지 큐잉

- ☐ 연결 끊김 동안 발생한 `MeterValues`, `StatusNotification` 등을 비휘발성 메모리에 큐 저장
- ☐ 큐 최대 크기 설정 (권장: 256~1024개 메시지)
- ☐ 재연결 성공 후 큐에 쌓인 메시지를 순서대로 전송
- ☐ 큐가 가득 찬 경우 오래된 메시지부터 삭제 (FIFO 오버플로우 정책)
- ☐ `StartTransaction`, `StopTransaction`은 절대 삭제하지 않음 — 별도 우선순위 큐 처리

### 8.5 JSON 처리 보안

#### 권장 JSON 라이브러리

| 라이브러리 | 언어 | 특징 | 권장도 |
|-----------|------|------|--------|
| **cJSON** | C | 경량, MIT 라이선스, 널리 사용 | ✅ 1순위 |
| **ArduinoJson** | C++ | 정적 메모리 할당 가능, 임베디드 최적화 | ✅ 권장 |
| **jsmn** | C | 최소 메모리, 토크나이저 방식 | 메모리 극소 환경 |
| **Jansson** | C | POSIX 환경 적합, 다양한 기능 | ⚠️ 메모리 여유 필요 |

#### JSON 보안 체크리스트

- ☐ JSON 입력 최대 크기 제한 설정 (권장: 4 KB 이하)
- ☐ 중첩 깊이 제한 (권장: 최대 10 레벨)
- ☐ OCPP 메시지 ID 문자열 최대 길이 제한 (권장: 36자, UUID 길이)
- ☐ 알 수 없는 필드가 포함된 JSON을 처리할 때 메모리 오버플로우 방지
- ☐ 정수형 범위 검증 (음수, 최대값 초과 등)

---

### Self-check — 섹션 8 WebSocket / OCPP

- ☐ `Sec-WebSocket-Protocol: ocpp1.6` 헤더 설정 확인
- ☐ `Authorization: Basic` 헤더 설정 확인
- ☐ WebSocket Ping/Pong 60초 주기 구현 확인
- ☐ TCP Keepalive 설정 확인
- ☐ Exponential Backoff 재연결 구현 확인
- ☐ 연결 끊김 메시지 큐 구현 확인
- ☐ JSON 최대 크기/깊이 제한 구현 확인

---

## 9. OTA 펌웨어 업데이트 보안

### 9.1 OTA 아키텍처 요구사항

```
[CSMS → OCPP UpdateFirmware 명령]
         │
         ▼
[충전기: 펌웨어 이미지 다운로드]
  - 다운로드 URL: HTTPS (TLS 검증 필수)
  - Root CA 검증: 위 4섹션 기준 동일 적용
         │
         ▼
[펌웨어 이미지 서명 검증]
  - 서명 알고리즘: ECDSA-P256 + SHA-256
  - 공개키: 번들에 하드코딩 (변경 불가)
  - 서명 파일: 이미지와 별도 파일 또는 이미지 헤더에 포함
         │
         ├── 서명 검증 실패 → 이미지 삭제, 재시도 없음, 현재 펌웨어 유지
         │
         ▼
[버전 검증]
  - 다운로드 이미지 버전 > 현재 버전: 허용
  - 다운로드 이미지 버전 <= 현재 버전: 거부 (롤백 방지)
         │
         ▼
[A/B 파티션에 쓰기]
  - 활성 파티션: 변경하지 않음
  - 대기 파티션에 새 이미지 기록
  - 기록 완료 후 CRC/SHA256 검증
         │
         ▼
[Bootloader가 스왑]
  - 재시작 후 새 파티션으로 부팅
  - 일정 시간(예: 5분) OCPP 연결 정상이면 커밋
  - 연결 실패 시 이전 파티션으로 자동 롤백
```

### 9.2 OTA 보안 체크리스트

#### 코드 서명

- ☐ OTA 이미지에 ECDSA-P256 + SHA-256 서명 적용
- ☐ 서명 검증 공개키를 Bootloader 영역 또는 OTP에 저장 (펌웨어 업데이트로 변경 불가)
- ☐ 서명 검증 실패 시 절대 부팅하지 않음
- ☐ OTA 이미지 헤더에 버전, 크기, 서명이 포함된 구조 정의

```c
/* OTA 이미지 헤더 구조 예시 */
typedef struct {
    uint32_t magic;          /* 0xC4A12601 — Pvpentech OTA v1 */
    uint32_t version;        /* 시맨틱 버전 (major:minor:patch 각 8bit) */
    uint32_t image_size;     /* 이미지 크기 (헤더 제외) */
    uint32_t crc32;          /* 이미지 CRC32 */
    uint8_t  signature[64];  /* ECDSA-P256 서명 (r:s 각 32바이트) */
    uint8_t  reserved[32];
} __attribute__((packed)) ota_header_t;
```

#### 롤백 방지

- ☐ 현재 버전보다 낮은 버전의 OTA 이미지 적용 거부
- ☐ Bootloader에서 버전 비교 로직 구현 (서비스 레이어에만 두지 않음)
- ☐ 보안 취약점 수정 버전의 경우 Anti-rollback 카운터(Fuse 기반) 증가 고려

#### A/B 파티션

- ☐ App A / App B 두 파티션 분리 설계
- ☐ 새 이미지를 대기 파티션에 기록하는 동안 현재 파티션으로 정상 동작 유지
- ☐ 새 이미지 부팅 후 정상 동작 확인 시간(watchdog) 내 CSMS 연결 성공 → 커밋
- ☐ 커밋 실패 시 이전 파티션으로 자동 롤백

#### OTA 채널 보안

- ☐ OTA 이미지 다운로드 URL이 HTTPS (TLS 1.2 이상)
- ☐ 다운로드 서버 인증서도 섹션 4의 검증 기준과 동일하게 검증
- ☐ OTA 다운로드 진행률을 OCPP `FirmwareStatusNotification`으로 CSMS에 보고

#### 갱신 가능 항목

- ☐ Root CA 번들 단독 갱신 가능 (펌웨어 전체 업데이트 불필요)
- ☐ TLS 라이브러리 포함 App 이미지 갱신 가능
- ☐ OCPP 핸들러 갱신 가능
- ☐ `stationId` / `password` 갱신 가능 (OCPP `ChangeConfiguration` 또는 재프로비저닝)

---

### Self-check — 섹션 9 OTA

- ☐ ECDSA 코드 서명 검증 구현 완료
- ☐ 롤백 방지 버전 비교 로직 구현 완료
- ☐ A/B 파티션 설계 완료
- ☐ OTA 다운로드 TLS 검증 (섹션 4 기준) 적용 확인
- ☐ 서명 검증 실패 시 이미지 거부 동작 확인
- ☐ 자동 롤백 메커니즘 구현 완료

---

## 10. 네트워크 안정성 / 운영 고려사항

### 10.1 네트워크 환경별 고려사항

| 네트워크 | 주요 이슈 | 권장 설정 |
|----------|-----------|-----------|
| **LTE Cat-M1 / NB-IoT** | 높은 레이턴시(100~500ms), 간헐적 연결 끊김, 데이터 한도 | Heartbeat 120초, 작은 메시지 크기, 압축 고려 |
| **LTE Cat-1 / Cat-4** | 안정적, 낮은 레이턴시 | Heartbeat 60초, 표준 설정 |
| **Ethernet** | 가장 안정적, 저레이턴시 | Heartbeat 60초, 추가 최적화 불필요 |
| **Wi-Fi** | SSID 변경, 로밍, 신호 약화 | WPA2-Enterprise 또는 WPA3 필수, WEP/WPA ❌ 금지 |

### 10.2 권장 설정값 요약

| 항목 | LTE Cat-M1 | LTE Cat-1 이상 / Ethernet |
|------|-----------|--------------------------|
| OCPP HeartbeatInterval | 120 s | 60 s |
| WebSocket Ping 주기 | 60 s | 60 s |
| Ping Pong 응답 대기 | 15 s | 10 s |
| TLS 핸드셰이크 타임아웃 | 30 s | 15 s |
| WebSocket 연결 타임아웃 | 30 s | 15 s |
| 재연결 초기 대기 | 5 s | 1 s |
| 재연결 최대 대기 | 300 s | 60 s |
| 메시지 응답 대기 (OCPP) | 45 s | 30 s |
| 메시지 큐 최대 크기 | 256개 | 1024개 |

### 10.3 메시지 재전송 큐 설계

```
[비휘발성 메시지 큐 구조]
┌────────────────────────────────────────────────────────┐
│ 우선순위 큐 1 (High): StartTransaction, StopTransaction │
│   - 절대 삭제 안 함, 무제한 재전송                       │
│   - 최대 크기: 64개                                     │
├────────────────────────────────────────────────────────┤
│ 우선순위 큐 2 (Normal): StatusNotification, Authorize   │
│   - 최대 256개, FIFO 오버플로우 정책                     │
├────────────────────────────────────────────────────────┤
│ 우선순위 큐 3 (Low): MeterValues (중간값)               │
│   - 최대 512개, 오버플로우 시 오래된 것 삭제             │
└────────────────────────────────────────────────────────┘
```

- ☐ 우선순위별 큐 분리 구현
- ☐ 큐를 비휘발성 메모리(EEPROM, Flash NVS)에 유지
- ☐ 재연결 후 큐 드레인 시 초당 최대 전송 속도 제한 (서버 부하 방지)

### 10.4 Wi-Fi 환경 추가 보안

- ☐ WEP, WPA (TKIP) 사용 ❌ 금지
- ☐ WPA2-Personal (AES-CCMP) 최소 요구사항
- ☐ (권장) WPA2-Enterprise 또는 WPA3
- ☐ SSID/패스워드 저장 시 섹션 7과 동일한 보안 수준 적용
- ☐ 공개 Wi-Fi(Open Network) 연결 ❌ 금지
- ☐ Wi-Fi 프로비저닝 과정 자체를 보호된 채널에서만 수행

---

### Self-check — 섹션 10 네트워크 안정성

- ☐ 사용 네트워크 타입에 맞는 타임아웃 / Heartbeat 값 설정 완료
- ☐ 우선순위 기반 메시지 큐 구현 완료
- ☐ Wi-Fi 사용 시 WPA2/WPA3 설정 확인
- ☐ 메시지 재전송 속도 제한 구현 확인

---

## 11. 보안 테스트 / 검증 항목

### 11.1 정상 시나리오 검증

| 테스트 항목 | 기대 결과 | 검증 방법 |
|-------------|-----------|-----------|
| `wss://pvpentech.kr/ocpp/<stationId>` 접속 | WebSocket 연결 성공, OCPP BootNotification 정상 처리 | 실 서버 테스트 |
| TLS 1.2로 강제 연결 | 연결 성공 (서버 지원) | `openssl s_client -tls1_2` |
| TLS 1.3으로 강제 연결 | 연결 성공 (서버 지원) | `openssl s_client -tls1_3` |
| `Sec-WebSocket-Protocol: ocpp1.6` 포함 | 101 Switching Protocols | WebSocket 핸드셰이크 로그 확인 |
| Valid Basic Auth | 연결 수락 | 서버 로그 확인 |

### 11.2 인증서 검증 거부 시나리오 (모두 거부해야 정상)

| 시나리오 | 기대 결과 | 테스트 방법 |
|----------|-----------|-------------|
| **자체 서명(Self-signed) 인증서** 서버 | 연결 거부 (인증서 검증 실패) | mitmproxy 자체 서명 인증서로 프록시 |
| **만료된 인증서** | 연결 거부 (`BADCERT_EXPIRED`) | mitmproxy + 만료 인증서 설정 |
| **도메인 불일치** (`wrongdomain.com`) | 연결 거부 (`BADCERT_CN_MISMATCH`) | `/etc/hosts` 또는 DNS 재설정 후 다른 도메인 인증서 사용 |
| **SHA1 서명 인증서** | 연결 거부 (`BADCERT_BAD_MD`) | 테스트용 SHA1 인증서 생성 후 mitmproxy 사용 |
| **취소된(Revoked) 인증서** (OCSP 구현 시) | 연결 거부 | OCSP 테스트 서버 구성 |
| **Root CA 미포함** (번들에서 ISRG Root X1 제거) | 연결 거부 (`BADCERT_NOT_TRUSTED`) | 테스트 펌웨어에서 CA 제거 후 시도 |
| **중간 CA 없는 체인** (Leaf만 전송) | 연결 거부 (`BADCERT_MISSING`) | openssl을 이용한 불완전 체인 서버 구성 |

### 11.3 TLS 다운그레이드 / 프로토콜 공격 방어 테스트

| 테스트 항목 | 기대 결과 |
|-------------|-----------|
| TLS 1.0으로 연결 시도 | 핸드셰이크 실패 (클라이언트 자체 거부) |
| TLS 1.1으로 연결 시도 | 핸드셰이크 실패 (클라이언트 자체 거부) |
| `RC4` cipher 강제 시도 | cipher suite 협상 실패 |
| `NULL` cipher 강제 시도 | cipher suite 협상 실패 |
| `3DES` cipher 강제 시도 | cipher suite 협상 실패 |
| CBC-mode cipher만 제공하는 서버 | 연결 거부 |

```bash
# testssl.sh를 이용한 서버 검증 (개발 PC에서 서버 측 검증용)
./testssl.sh --tls1 pvpentech.kr      # TLS 1.0 비활성화 확인
./testssl.sh --tls1_1 pvpentech.kr    # TLS 1.1 비활성화 확인
./testssl.sh --rc4 pvpentech.kr       # RC4 비활성화 확인
./testssl.sh --3des pvpentech.kr      # 3DES 비활성화 확인
./testssl.sh -U pvpentech.kr          # 전체 취약점 스캔
```

### 11.4 mitmproxy를 이용한 클라이언트 검증

```bash
# mitmproxy 설치 및 HTTPS 인터셉트 설정
pip install mitmproxy

# 투명 프록시 모드로 실행 (충전기와 같은 네트워크 세그먼트에서)
mitmproxy --mode transparent --showhost

# mitmproxy 자체 CA로 인증서 교체 → 충전기가 연결 거부하면 정상
# mitmproxy CA를 신뢰하지 않도록 충전기 번들에 포함되지 않은 CA 사용

# WebSocket 트래픽 필터링
mitmproxy --mode transparent -k --flow-detail 3

# 충전기 측에서 연결 거부 로그 확인:
# "certificate verify failed: unable to get local issuer certificate"
# → 정상 동작 (mitmproxy CA 거부)
```

```bash
# Burp Suite CE를 이용한 WebSocket 검증
# 1. Burp Suite 프록시 설정 (127.0.0.1:8080)
# 2. Proxy → Options → Add listener → All interfaces
# 3. 충전기 네트워크 게이트웨이를 Burp 프록시로 설정
# 4. WebSocket history 탭에서 OCPP 메시지 확인
# 5. Burp CA 인증서 → 충전기가 거부하면 정상
```

### 11.5 nmap을 이용한 포트/TLS 스캔

```bash
# 서버 TLS 설정 확인 (개발 PC에서)
nmap --script ssl-enum-ciphers -p 443 pvpentech.kr

# 기대 결과 (TLS 1.0/1.1이 없어야 정상):
# TLSv1.2: ciphers listed
# TLSv1.3: ciphers listed
# (TLSv1.0, TLSv1.1 없음)

# HSTS 확인
curl -I https://pvpentech.kr | grep -i strict
```

### 11.6 시간 미동기 시 동작 확인

- ☐ RTC를 2020년 1월 1일로 강제 설정 → `BootNotification` 응답 `currentTime`으로 보정되는지 확인
- ☐ RTC를 2040년 1월 1일로 강제 설정 → 인증서 만료 오류 발생, 시각 보정 후 재연결 확인
- ☐ NTP 서버를 차단한 상태에서 부팅 → Fallback 정책 동작 확인

### 11.7 장시간 안정성 (메모리 누수)

- ☐ 72시간 연속 운전 테스트 (연결 유지)
- ☐ 1000회 자동 재연결 테스트 (연결 → 강제 끊김 → 재연결 반복)
- ☐ 각 테스트 전후 Heap Free 메모리 비교 (누수 없어야 정상)
- ☐ TLS 컨텍스트 해제 코드 확인 (`mbedtls_ssl_free`, `mbedtls_ssl_config_free`)

```c
/* TLS 컨텍스트 정리 — 재연결 시 반드시 호출 */
void tls_cleanup(tls_context_t *ctx) {
    mbedtls_ssl_free(&ctx->ssl);
    mbedtls_ssl_config_free(&ctx->conf);
    mbedtls_x509_crt_free(&ctx->cacert);
    mbedtls_ctr_drbg_free(&ctx->drbg);
    mbedtls_entropy_free(&ctx->entropy);
    memset(ctx, 0, sizeof(tls_context_t));
}
```

### 11.8 OCA OCPP 1.6 Compliance Test Tool

- ☐ OCA(Open Charge Alliance) 공식 OCPP 1.6 Compliance Test Tool 사용
  - 다운로드: https://www.openchargealliance.org/protocols/ocpp-16/
- ☐ Core 프로파일 필수 테스트 항목 전체 통과
- ☐ Smart Charging 프로파일 (해당 시) 테스트

---

### Self-check — 섹션 11 보안 테스트

- ☐ 정상 연결 시나리오 테스트 완료
- ☐ 7가지 인증서 검증 거부 시나리오 모두 거부 확인
- ☐ TLS 다운그레이드 방어 테스트 완료
- ☐ mitmproxy 테스트로 클라이언트 측 검증 완료
- ☐ 72시간 안정성 테스트 완료 (메모리 누수 없음)
- ☐ OCA OCPP 1.6 Compliance 테스트 통과

---

## 12. 인증 / 규제 (한국 시장)

### 12.1 한국 시장 필수 인증

| 인증 | 발급 기관 | 필수 여부 | 비고 |
|------|-----------|-----------|------|
| **KC 인증** (전기용품 안전인증) | KTL, KTC, KERI 등 | ✅ 필수 | 전기차 충전기는 안전인증 대상 |
| **전파인증** (전자기기 EMC) | 국립전파연구원 | ✅ 필수 | LTE/Wi-Fi 모듈 탑재 시 |
| **형식승인** (환경부, 충전기) | 환경부 | ✅ 필수 | 공공 충전 보조금 수령 시 |
| **OCA OCPP 1.6 Compliance** | Open Charge Alliance | ✅ 강력 권장 | Pvpentech 호환성 보증 |
| **CC (Common Criteria)** | 국가정보원 | 선택 | 공공기관 납품 시 요구될 수 있음 |

### 12.2 KC 인증 관련 보안 고려사항

- ☐ 전기용품 안전관리법 적합 — 전기적 안전 요구사항 준수
- ☐ EMC (전자기 적합성) 인증 — LTE/Wi-Fi 전파 방해 기준 통과
- ☐ KC 인증 후 펌웨어 변경 시 재인증 필요 여부 확인 (보안 수정 OTA 배포와 연계)

### 12.3 개인정보보호법 관련

- ☐ 충전기 펌웨어에서 사용자 개인정보(이름, 연락처 등) 로컬 저장 금지
- ☐ `idTag` (RFID/앱 사용자 식별자)는 인증 목적으로만 사용하고 로컬에 장기 저장 금지
- ☐ 충전 이력 로그에 개인식별정보 포함 시 암호화 또는 익명화 처리
- ☐ 진단 로그 수집 시 개인정보 포함 여부 검토 (OCPP `GetDiagnostics`)

### 12.4 OCPP 1.6 Compliance 핵심 요구사항

충전기가 Pvpentech CSMS와 정상 통신하기 위해 반드시 구현해야 하는 OCPP 1.6 Core 프로파일 Actions:

| Action | 방향 | 필수 여부 |
|--------|------|-----------|
| `BootNotification` | CP → CS | ✅ 필수 |
| `Heartbeat` | CP → CS | ✅ 필수 |
| `StatusNotification` | CP → CS | ✅ 필수 |
| `Authorize` | CP → CS | ✅ 필수 |
| `StartTransaction` | CP → CS | ✅ 필수 |
| `StopTransaction` | CP → CS | ✅ 필수 |
| `MeterValues` | CP → CS | ✅ 필수 |
| `RemoteStartTransaction` | CS → CP | ✅ 필수 |
| `RemoteStopTransaction` | CS → CP | ✅ 필수 |
| `ChangeConfiguration` | CS → CP | ✅ 필수 |
| `GetConfiguration` | CS → CP | ✅ 필수 |
| `Reset` | CS → CP | ✅ 필수 |
| `UnlockConnector` | CS → CP | ✅ 필수 |
| `UpdateFirmware` | CS → CP | ✅ 필수 (OTA) |

---

### Self-check — 섹션 12 인증/규제

- ☐ KC 인증 일정 계획 수립 완료
- ☐ OCPP 1.6 Core 프로파일 필수 Actions 구현 완료
- ☐ 개인정보 로컬 저장 없음 확인
- ☐ OCA Compliance 테스트 계획 수립 완료

---

## 13. 성능 / 메모리 가이드

### 13.1 TLS 핸드셰이크 성능 참고치

다음 수치는 80~120 MHz MCU, 소프트웨어 ECC, mbedTLS 3.x 기준 실측 참고치입니다. 하드웨어 가속기 사용 시 크게 개선됩니다.

| 항목 | TLS 1.2 (ECDHE_ECDSA_AES128_GCM) | TLS 1.3 (AES_128_GCM) |
|------|-----------------------------------|------------------------|
| **핸드셰이크 RAM 사용량** | ~40~60 KB (피크) | ~32~50 KB (피크) |
| **핸드셰이크 시간** (소프트 ECC, 80 MHz) | ~3~8초 | ~2~5초 |
| **핸드셰이크 시간** (하드웨어 ECC 가속) | ~0.5~1.5초 | ~0.3~1초 |
| **핸드셰이크 트래픽** (왕복) | ~3~5 KB | ~2~4 KB |
| **레코드 암호화 오버헤드** | ~29 bytes/레코드 | ~22 bytes/레코드 |
| **Flash (라이브러리)** | ~90~130 KB (최적화 빌드) | ~100~150 KB |

### 13.2 OCPP 메시지별 메모리 사용량

| 메시지 타입 | 평균 JSON 크기 | 권장 버퍼 크기 |
|-------------|----------------|----------------|
| BootNotification | ~300~500 bytes | 1 KB |
| Heartbeat | ~60 bytes | 256 bytes |
| StatusNotification | ~200~350 bytes | 512 bytes |
| StartTransaction | ~300~450 bytes | 1 KB |
| StopTransaction + MeterValues | ~500~2000 bytes | 4 KB |
| MeterValues (샘플 다수) | ~500~3000 bytes | 4 KB |

### 13.3 권장 Heap Free 메모리

| 상태 | 권장 Heap Free |
|------|----------------|
| TLS 핸드셰이크 전 | 128 KB 이상 |
| TLS 핸드셰이크 중 (피크) | 64 KB 이상 남아 있어야 함 |
| OCPP 정상 동작 중 | 64 KB 이상 |
| OTA 다운로드 중 | 32 KB 이상 (이미지 스트리밍 처리 시) |

- ☐ 부팅 시 Heap 여유 메모리 로깅 구현
- ☐ Heap 여유 메모리가 임계값 이하로 떨어지면 경고 로그 + CSMS에 알림
- ☐ 장시간 운전 중 Heap 사용량 모니터링 로직 구현

### 13.4 Flash 공간 예산

```
권장 파티션 공간 배분 예시 (2 MB Flash 기준):
┌──────────────────────────────────────────────────────┐
│ Bootloader:          64 KB                           │
│ App A (Active):     640 KB                           │
│ App B (Standby):    640 KB                           │
│ Root CA Bundle:      32 KB (PEM 형식 2개)            │
│ Config / NVS:        64 KB                           │
│ Message Queue:      128 KB                           │
│ OTA Scratch:         32 KB                           │
│ 여유:               ~464 KB                          │
└──────────────────────────────────────────────────────┘
```

---

### Self-check — 섹션 13 성능/메모리

- ☐ 타겟 MCU에서 TLS 핸드셰이크 시간 실측 완료 (목표: 10초 이내)
- ☐ Heap Free 모니터링 코드 구현 완료
- ☐ 파티션 레이아웃 확정 완료

---

## 14. 사전 결정 체크리스트 (개발 착수 전)

아래 항목은 개발 착수 전에 팀 내에서 결정을 완료해야 합니다. 결정이 후속 구현 전체에 영향을 미치는 핵심 사항입니다.

### 14.1 하드웨어 / 플랫폼

- ☐ **1. MCU 선정 완료** — TLS 1.3 지원 TLS 라이브러리와 연동 가능한 MCU인지 검증 완료
- ☐ **2. TRNG 소스 확보** — MCU 내장 TRNG 또는 외부 TRNG 칩 선정 완료, TLS 라이브러리와 연결 방법 확정
- ☐ **3. RTC 및 배터리 백업 설계** — 전원 차단 후 시각 유지 가능한 RTC 및 배터리 백업 회로 설계 완료
- ☐ **4. Secure Element 탑재 여부** — ATECC608, SE050 등 탑재 여부 및 연동 방식(I2C/SPI) 확정
- ☐ **5. 하드웨어 암호 가속기 활성화 여부** — MCU 벤더 HAL 연동 계획 확정

### 14.2 TLS / 보안 라이브러리

- ☐ **6. TLS 라이브러리 선정** — mbedTLS 3.x / wolfSSL / LTE 모듈 내장 TLS 중 선택 완료
- ☐ **7. TLS 라이브러리 버전 고정** — 사용 버전 확정, 보안 패치 추적 정책 수립 완료
- ☐ **8. LTE 모듈 내장 TLS 사용 여부** — 사용 시 ECDSA 인증서 검증 지원 여부 모듈 벤더 확인 완료
- ☐ **9. cipher suite 화이트리스트** — 활성화할 cipher suite 목록 확정 (섹션 3.2 기준)

### 14.3 인증서 / Root CA

- ☐ **10. Root CA 번들 저장 위치** — 별도 파티션 / EEPROM 섹터 / NVS 구조 확정
- ☐ **11. Root CA OTA 갱신 정책** — Root CA 단독 갱신 OTA 지원 여부 및 구조 설계 완료
- ☐ **12. ISRG Root X1 만료 대응 계획** — 2030년 9월 만료 전 갱신 배포 계획 수립 완료

### 14.4 자격증명 / 프로비저닝

- ☐ **13. 자격증명 저장 방식 확정** — Secure Element / TrustZone / 소프트웨어 암호화 중 선택 및 구현 계획 확정
- ☐ **14. 프로비저닝 흐름 확정** — `POST /provision` 사용, serial_number 기반 등록 흐름 확인 (참조: `12_charger_provisioning.md`)
- ☐ **15. 자격증명 갱신 정책** — 비밀번호 주기적 교체 방법 결정 (OCPP `ChangeConfiguration` 또는 재프로비저닝)

### 14.5 OTA / 안정성

- ☐ **16. A/B 파티션 레이아웃** — 파티션 크기 및 경계 확정, Bootloader 지원 여부 확인
- ☐ **17. OTA 코드 서명 키 관리** — ECDSA 서명 키 생성, 공개키 배포 위치(Bootloader/OTP) 확정
- ☐ **18. Anti-rollback 정책** — 버전 다운그레이드 방지 방식 결정 (소프트웨어 비교 / Fuse 카운터)
- ☐ **19. 메시지 큐 크기 및 저장 위치** — 비휘발성 큐 최대 크기 및 NVS 섹터 위치 확정
- ☐ **20. 재연결 Backoff 파라미터** — 네트워크 타입 기준 초기/최대 대기 시간 확정

---

## 15. 부록

### 부록 A. 권장 Root CA 다운로드 출처

| CA | URL |
|----|-----|
| ISRG Root X1 (PEM) | https://letsencrypt.org/certs/isrgrootx1.pem |
| ISRG Root X1 (DER) | https://letsencrypt.org/certs/isrgrootx1.der |
| ISRG Root X2 (PEM) | https://letsencrypt.org/certs/isrg-root-x2.pem |
| ISRG Root X2 (DER) | https://letsencrypt.org/certs/isrg-root-x2.der |
| 전체 인증서 목록 | https://letsencrypt.org/certificates/ |
| 인증서 체인 호환성 정보 | https://letsencrypt.org/docs/certificate-compatibility/ |

> **⚠️ 주의**: 다운로드한 Root CA PEM의 SHA256 핑거프린트를 Let's Encrypt 공식 사이트에서 반드시 교차 확인하세요.

---

### 부록 B. mbedTLS `config.h` 핵심 옵션

Pvpentech CSMS 접속을 위한 mbedTLS 최소 필수 설정입니다.

```c
/* mbedTLS config.h — Pvpentech 클라이언트 필수 설정 */

/* === 필수 활성화 === */
#define MBEDTLS_SSL_TLS_C              /* TLS 프로토콜 */
#define MBEDTLS_SSL_CLI_C              /* TLS 클라이언트 */
#define MBEDTLS_TLS_DEFAULT_ALLOW_SHA1_IN_CERTIFICATES  /* 비활성화 권장 */
#undef  MBEDTLS_TLS_DEFAULT_ALLOW_SHA1_IN_CERTIFICATES  /* SHA1 서명 인증서 거부 */

/* TLS 버전 */
#define MBEDTLS_SSL_PROTO_TLS1_2       /* TLS 1.2 활성화 */
#define MBEDTLS_SSL_PROTO_TLS1_3       /* TLS 1.3 활성화 */
#undef  MBEDTLS_SSL_PROTO_TLS1        /* TLS 1.0 비활성화 */
#undef  MBEDTLS_SSL_PROTO_TLS1_1      /* TLS 1.1 비활성화 */

/* 인증서 관련 */
#define MBEDTLS_X509_CRT_PARSE_C       /* X.509 인증서 파싱 */
#define MBEDTLS_X509_USE_C             /* X.509 유효성 검사 */

/* ECDHE / ECDSA (Pvpentech 서버 호환 필수) */
#define MBEDTLS_ECDH_C                 /* ECDH 키 교환 */
#define MBEDTLS_ECDSA_C                /* ECDSA 서명 */
#define MBEDTLS_ECP_C                  /* ECC 기반 연산 */
#define MBEDTLS_ECP_DP_SECP256R1_ENABLED  /* P-256 필수 */
#define MBEDTLS_ECP_DP_CURVE25519_ENABLED /* x25519 (TLS 1.3) */

/* AES-GCM (cipher suite 호환) */
#define MBEDTLS_AES_C
#define MBEDTLS_GCM_C
#define MBEDTLS_CIPHER_MODE_GCM

/* ChaCha20-Poly1305 (선택, TLS 1.3) */
#define MBEDTLS_CHACHA20_C
#define MBEDTLS_POLY1305_C
#define MBEDTLS_CHACHAPOLY_C

/* SHA-256 / SHA-384 */
#define MBEDTLS_SHA256_C
#define MBEDTLS_SHA512_C               /* SHA-384 포함 */

/* 난수 */
#define MBEDTLS_CTR_DRBG_C
#define MBEDTLS_ENTROPY_C
/* 하드웨어 엔트로피 소스 */
#define MBEDTLS_ENTROPY_HARDWARE_ALT   /* 직접 구현 필요 */

/* SNI 지원 */
#define MBEDTLS_SSL_SERVER_NAME_INDICATION

/* === 비활성화 (취약/불필요) === */
#undef MBEDTLS_ARC4_C                  /* RC4 비활성화 */
#undef MBEDTLS_DES_C                   /* 3DES 비활성화 */
#undef MBEDTLS_SSL_SRV_C               /* 서버 사이드 (클라이언트 전용) */
#undef MBEDTLS_MD5_C                   /* MD5 (필요 시 부분 허용) */
/* MBEDTLS_SSL_PROTO_DTLS 비필요 시 비활성화 */
```

> **⚠️ 주의**: `MBEDTLS_ENTROPY_HARDWARE_ALT`를 정의한 경우 `mbedtls_hardware_poll()` 함수를 MCU의 TRNG에 연결하는 구현이 반드시 필요합니다. 미구현 시 빌드는 되지만 소프트웨어 PRNG만 사용되어 보안 취약점이 발생합니다.

---

### 부록 C. 검증 명령어 모음

```bash
# ── 서버 TLS 설정 확인 (개발 PC) ──────────────────────────────────────────

# openssl: TLS 버전 / cipher suite 확인
openssl s_client -connect pvpentech.kr:443 -tls1_2 -showcerts
openssl s_client -connect pvpentech.kr:443 -tls1_3 -showcerts

# 서버 인증서 상세 정보 확인
openssl s_client -connect pvpentech.kr:443 2>/dev/null | openssl x509 -noout -text

# 인증서 체인 확인
openssl s_client -connect pvpentech.kr:443 -showcerts 2>/dev/null \
    | openssl storeutl -noout -text /dev/stdin

# TLS 1.0 / 1.1 비활성화 확인 (오류 반환이 정상)
openssl s_client -connect pvpentech.kr:443 -tls1   # 실패해야 정상
openssl s_client -connect pvpentech.kr:443 -tls1_1 # 실패해야 정상

# ── testssl.sh ────────────────────────────────────────────────────────────

# 설치
git clone --depth 1 https://github.com/drwetter/testssl.sh.git
cd testssl.sh

# 전체 스캔
./testssl.sh pvpentech.kr

# cipher suite 상세 스캔
./testssl.sh --cipher-per-proto pvpentech.kr

# 취약점 스캔 (BEAST, POODLE, ROBOT 등)
./testssl.sh -U pvpentech.kr

# ── nmap ─────────────────────────────────────────────────────────────────

# SSL/TLS cipher 열거
nmap --script ssl-enum-ciphers -p 443 pvpentech.kr

# 인증서 정보
nmap --script ssl-cert -p 443 pvpentech.kr

# 취약한 버전 탐지
nmap --script sslv2,ssl-dh-params -p 443 pvpentech.kr

# ── WebSocket 연결 테스트 ──────────────────────────────────────────────

# wscat을 이용한 OCPP WebSocket 연결 테스트
npx wscat \
    --connect "wss://pvpentech.kr/ocpp/EN1000001" \
    --subprotocol "ocpp1.6" \
    --header "Authorization: Basic $(echo -n 'EN1000001:password' | base64)"

# curl WebSocket 업그레이드 (curl 7.86+)
curl --http1.1 \
     -H "Upgrade: websocket" \
     -H "Connection: Upgrade" \
     -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     -H "Sec-WebSocket-Version: 13" \
     -H "Sec-WebSocket-Protocol: ocpp1.6" \
     -H "Authorization: Basic $(echo -n 'EN1000001:password' | base64)" \
     -v \
     https://pvpentech.kr/ocpp/EN1000001

# ── mitmproxy (클라이언트 인증서 검증 확인) ────────────────────────────────

# mitmproxy 설치
pip install mitmproxy

# 투명 프록시 모드 시작
mitmweb --mode transparent --showhost --web-port 8081

# 충전기 트래픽을 mitmproxy로 라우팅 후
# "certificate verify failed" 오류가 충전기에 발생하면 정상 동작
```

---

### 부록 D. 참고 문서 / RFC

| 문서 | 내용 | 링크 |
|------|------|------|
| RFC 8446 | TLS 1.3 스펙 | https://tools.ietf.org/html/rfc8446 |
| RFC 5246 | TLS 1.2 스펙 | https://tools.ietf.org/html/rfc5246 |
| RFC 7525 | TLS 권장 설정 (BCP 195) | https://tools.ietf.org/html/rfc7525 |
| RFC 7465 | RC4 금지 | https://tools.ietf.org/html/rfc7465 |
| RFC 6347 | DTLS 1.2 (참고) | https://tools.ietf.org/html/rfc6347 |
| RFC 6455 | WebSocket 프로토콜 | https://tools.ietf.org/html/rfc6455 |
| OCPP 1.6 J Specification | OCA 공식 OCPP 1.6 JSON 스펙 | https://www.openchargealliance.org/ |
| NIST SP 800-52 Rev 2 | TLS 구현 가이드라인 | https://csrc.nist.gov/publications/detail/sp/800-52/rev-2/final |
| mbedTLS 문서 | mbedTLS 3.x API Reference | https://mbed-tls.readthedocs.io/ |
| wolfSSL 문서 | wolfSSL 임베디드 TLS | https://www.wolfssl.com/documentation/ |
| ISRG Root CA 정보 | Let's Encrypt 인증서 상세 | https://letsencrypt.org/certificates/ |
| OCA Compliance | OCPP Compliance Test Tool | https://www.openchargealliance.org/ |
| Pvpentech 설계 가이드 | OCPP WebSocket 핸들러 | `documents/design_guide/03_ocpp_websocket_handler.md` |
| Pvpentech 설계 가이드 | 인증/인가 설계 | `documents/design_guide/06_auth_design.md` |
| Pvpentech 설계 가이드 | 충전기 프로비저닝 | `documents/design_guide/12_charger_provisioning.md` |
| Pvpentech 설계 가이드 | 환경 및 배포 (Nginx TLS) | `documents/design_guide/08_environment_and_deployment.md` |

---

## 최종 통과 체크리스트 (출하 전 최종 확인)

아래 항목은 양산 출하 전 반드시 확인해야 합니다.

| # | 항목 | 상태 |
|---|------|------|
| 1 | `MBEDTLS_SSL_VERIFY_REQUIRED` 활성화, VERIFY_NONE 코드 없음 | ☐ |
| 2 | ISRG Root X1 + X2 Root CA 번들 내장 | ☐ |
| 3 | TLS 1.0 / 1.1 비활성화 확인 | ☐ |
| 4 | ECDHE_ECDSA cipher suite 포함 확인 | ☐ |
| 5 | RC4, 3DES, NULL cipher 비활성화 확인 | ☐ |
| 6 | SNI `pvpentech.kr` 설정 확인 | ☐ |
| 7 | `Sec-WebSocket-Protocol: ocpp1.6` 헤더 확인 | ☐ |
| 8 | Basic Auth 헤더 정상 생성 확인 | ☐ |
| 9 | TRNG 소스 연결 확인 | ☐ |
| 10 | stationId / password 평문 Flash 저장 없음 확인 | ☐ |
| 11 | OTA 코드 서명 검증 코드 활성화 확인 | ☐ |
| 12 | A/B 파티션 및 롤백 방지 동작 확인 | ☐ |
| 13 | 72시간 연속 안정성 테스트 통과 | ☐ |
| 14 | mitmproxy 테스트 — 연결 거부 확인 | ☐ |
| 15 | OCA OCPP 1.6 Compliance 테스트 통과 | ☐ |

---

*문서 끝 — Pvpentech CSMS 충전기 클라이언트 보안 체크리스트 v1.0*
