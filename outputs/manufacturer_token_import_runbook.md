# 제조사 기존 토큰 임포트 운영 가이드

- **작성일**: 2026-05-07
- **대상**: Pvpentech CS 관리자
- **관련 PR**: feat/manufacturer_import_existing_token
- **API 버전**: 충전기 프로비저닝 v2.0+

---

## 1. 배경

기본 흐름은 **"CS가 신규 등록 → 서버가 64자 hex 랜덤 토큰 발급 → 제조사에 전달 → 펌웨어에 굽기"** 입니다.

그러나 **이미 펌웨어에 하드코딩된 x-token 으로 출고가 끝난 충전기**의 경우, 그 토큰을 바꿀 수 없으므로 CSMS가 **해당 토큰을 그대로 받아들여야** 합니다.

예시 — 제조사 GRE 의 출고 펌웨어:

```cpp
if (https.begin(service->location())) {
    https.addHeader("x-channel", "GRE");
    https.addHeader("x-token",   "4af9914893d343698cde96f7b576ebad");
    https.addHeader("Content-Type", "application/json");
}
```

이 채널/토큰 쌍을 CSMS 에 등록해야 해당 충전기들이 `/auths` 인증을 통과합니다.

---

## 2. 신규 등록 (임포트) — POST /api/portal/cs/manufacturers

### 2-A. CS 포털 UI 사용

1. CS 포털 로그인 → 좌측 메뉴 **제조사 관리**
2. 우측 상단 **+ 제조사 등록** 클릭
3. 모달 입력:
   - **채널 ID (x-channel)**: `GRE` (펌웨어가 보내는 값과 **대소문자까지 정확히 일치**)
   - **제조사명**: `GRE` 또는 정식 법인명
   - **☑ 기존 토큰 직접 입력** 체크
   - **기존 x-token**: `4af9914893d343698cde96f7b576ebad`
4. **등록** 클릭 → "등록 완료 — 기존 토큰 임포트" 모달이 뜨면 성공

### 2-B. curl 사용

```bash
CS_JWT="<CS_관리자_JWT>"

curl -X POST https://csms.pvpentech.com/api/portal/cs/manufacturers \
  -H "Authorization: Bearer $CS_JWT" \
  -H "Content-Type: application/json" \
  -d '{
        "channelId":  "GRE",
        "name":       "GRE",
        "plainToken": "4af9914893d343698cde96f7b576ebad"
      }'
```

**예상 응답 (201)**:

```json
{
  "success": true,
  "data": {
    "id": 7,
    "channelId": "GRE",
    "name": "GRE",
    "isActive": true,
    "createdAt": "2026-05-07T08:30:00.000Z",
    "updatedAt": "2026-05-07T08:30:00.000Z",
    "plainToken": "4af9914893d343698cde96f7b576ebad",
    "imported": true
  },
  "notice": "제조사가 제공한 기존 토큰으로 등록되었습니다. 펌웨어와 일치하는지 확인하세요."
}
```

> `imported: true` 가 응답에 포함되면 임포트 경로로 등록된 것입니다.
> 동일 `channelId` 가 이미 존재하면 409 Conflict — 기존 레코드의 토큰을 갱신하려면 §3 재발급-임포트 절차를 사용하세요.

---

## 3. 기존 레코드의 토큰 임포트 갱신 — POST /api/portal/cs/manufacturers/:id/regenerate-token

이미 등록된 제조사의 토큰만 특정 값으로 바꿔야 할 때 (예: 신규 펌웨어 출시로 토큰을 일괄 변경).

### 3-A. CS 포털 UI 사용

1. **제조사 관리** 화면에서 해당 제조사 행의 **토큰 재발급** 클릭
2. 모달에서 **☑ 기존 토큰 직접 입력** 체크 → **새 x-token** 입력 → **재발급**

### 3-B. curl 사용

```bash
curl -X POST https://csms.pvpentech.com/api/portal/cs/manufacturers/7/regenerate-token \
  -H "Authorization: Bearer $CS_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "plainToken": "4af9914893d343698cde96f7b576ebad" }'
```

> 본문 없이 호출하면 기존 동작(서버가 새 랜덤 64자 hex 발급)이 그대로 적용됩니다.

---

## 4. 검증 절차

### 4-A. 등록 직후 인증 시뮬레이션

GRE 펌웨어가 보내는 헤더 그대로 `/auths` 호출:

```bash
curl -X POST https://csms.pvpentech.com/auths \
  -H "x-channel: GRE" \
  -H "x-token:   4af9914893d343698cde96f7b576ebad" \
  -H "Content-Type: application/json" \
  -d '{
        "origin": "<사전등록된_시리얼번호>",
        "model":  "<펌웨어_모델명>"
      }'
```

- **200 + clientId/pwd/wsUrl 응답** → 인증·프로비저닝 정상
- **401** → channelId/대소문자 불일치 또는 토큰 불일치 — §5 트러블슈팅 참고

### 4-B. 실제 충전기 부팅 후

1. 펌웨어가 부팅 시 `/auths` 호출 → 200 응답 확인
2. 응답의 `wsUrl` 로 OCPP WebSocket 접속 시도
3. CS 포털 **충전기 관리** 화면에서 `lastHeartbeatAt` 갱신 확인

---

## 5. 트러블슈팅

| 증상 | 원인 후보 | 조치 |
|---|---|---|
| `/auths` 가 401 (등록 직후) | `channelId` 대소문자 불일치 (예: 펌웨어는 `GRE`, DB 는 `gre`) | 잘못된 레코드를 비활성화하고 정확한 대소문자로 재등록 |
| `/auths` 가 401 (등록 직후) | 임포트한 `plainToken` 이 펌웨어의 토큰과 다름 | §3 재발급-임포트로 펌웨어 토큰 값과 정확히 일치시킴 |
| POST 등록이 400 | `plainToken` 이 16~128자 범위 밖이거나 허용 문자 외 사용 | 펌웨어 토큰이 영문/숫자/`_`/`-` 외 문자라면 별도 협의 필요 |
| POST 등록이 409 | 동일 `channelId` 레코드 이미 존재 | §3 재발급-임포트 사용 또는 기존 레코드 비활성화 후 재등록 |

---

## 6. 보안 메모

- `plainToken` 은 요청 본문/응답에 1회 노출되며, DB 에는 bcrypt 해시(`tokenHash`)로만 저장됩니다.
- 등록·재발급 로그에는 `imported: true|false` 플래그가 기록되어, 자동발급/임포트 경로를 사후 감사할 수 있습니다.
- 임포트 토큰의 엔트로피는 입력값에 따라 결정됩니다. 32 hex(128-bit) 이상을 권장합니다.
- 본 가이드의 토큰 값(`4af9914893d343698cde96f7b576ebad`)은 GRE 출고 펌웨어 실 데이터입니다. 다른 시스템과 공유 시 동일한 주의가 필요합니다.
