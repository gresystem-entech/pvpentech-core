# GCP 방화벽 — SSH 22 포트 좁히기 운영 가이드

- **작성일**: 2026-05-08
- **대상 VM**: `pvpentech-vm` @ `asia-northeast3-a`
- **GCP Project**: `pvpentech-490312`
- **공인 IP**: `34.50.12.65`
- **목적**: SSH 무차별 대입 봇 노이즈 99% 제거 + 외부 공격면 축소
- **운영자 계정**: `gresystem2023@gmail.com` (`jeong` SSH 사용자)

---

## 1. 배경

GCP VM 의 기본 방화벽 `default-allow-ssh` 가 `0.0.0.0/0 → tcp:22` 로 열려 있어, 인터넷 봇들이 24/7 무차별 대입 시도를 보냅니다 (`Invalid user pvpentech`, `Invalid user root` 등 분당 수~수십 건).

현재 SSH 사용자는 `jeong` 단일 계정(key-only) 이므로 보안 위협은 낮지만, **`/var/log/auth.log` 와 `journalctl` 이 봇 시도로 가득 차 정상 로그 식별을 방해**합니다.

본 가이드는 **GCP 방화벽 레벨에서 22 포트를 본인 IP + IAP 만 허용**하도록 좁혀 봇을 TCP 핸드셰이크 단계에서 차단하는 절차입니다.

---

## 2. 변경 전후 비교

### Before
| 규칙 | Source | Action |
|---|---|---|
| `default-allow-ssh` | `0.0.0.0/0` | tcp:22 ALLOW |
| `default-allow-internal` | `10.128.0.0/9` | all (VM↔VM) |

### After
| 규칙 | Source | Target Tag | 비고 |
|---|---|---|---|
| `ssh-allow-myip` | `<운영자 IP>/32` | `ssh-allowed` | 일상 SSH |
| `ssh-allow-iap` | `35.235.240.0/20` | `ssh-allowed` | IAP 터널 (안전망) |
| `default-allow-ssh` | (disabled) | — | 비활성화, 며칠 후 삭제 |
| `default-allow-internal` | `10.128.0.0/9` | — | **건드리지 않음** (VM 간 통신) |

VM `pvpentech-vm` 에는 기존 태그(`http-server`, `https-server`, `ocpp-server`) 에 더해 `ssh-allowed` 태그를 추가합니다.

---

## 3. 사전 준비

```bash
# 3-1) 운영자 PC 의 공인 IP 확인
curl -s https://api.ipify.org; echo
# → 예: 59.12.54.93

# 3-2) GCP 컨텍스트 확인
gcloud config list
# → project = pvpentech-490312

# 3-3) VM 위치 확인
gcloud compute instances list --filter="name=pvpentech-vm"
# → ZONE = asia-northeast3-a, EXTERNAL_IP = 34.50.12.65

# 3-4) 현재 22 포트 허용 규칙 확인
gcloud compute firewall-rules list \
  --filter="direction=INGRESS" \
  --format="value(name,sourceRanges,allowed)" \
  | grep -E "tcp.*(22|0-65535)"
# → default-allow-ssh  0.0.0.0/0  tcp:22  ← 이게 광역 규칙
```

---

## 4. Phase 1 — 새 허용 규칙 2개 추가 (광역 규칙은 그대로 유지)

```bash
# ── 변수 — 본인 환경에 맞게 채우기 ─────────────────────
MY_IP="59.12.54.93/32"        # Phase 3-1 결과 + /32
ZONE="asia-northeast3-a"
PROJECT="pvpentech-490312"
# ───────────────────────────────────────────────────

# 4-1) VM 에 ssh-allowed 태그 추가 (기존 태그 보존됨)
gcloud compute instances add-tags pvpentech-vm \
  --zone=$ZONE \
  --tags=ssh-allowed

# 4-2) 운영자 IP 만 허용
gcloud compute firewall-rules create ssh-allow-myip \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:22 \
  --source-ranges="$MY_IP" \
  --target-tags=ssh-allowed \
  --description="SSH from operator home IP (jeong)"

# 4-3) IAP 허용 (IP 변경 시 안전망)
gcloud compute firewall-rules create ssh-allow-iap \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:22 \
  --source-ranges=35.235.240.0/20 \
  --target-tags=ssh-allowed \
  --description="SSH via Identity-Aware Proxy"
```

검증:

```bash
gcloud compute instances describe pvpentech-vm \
  --zone=$ZONE --format="value(tags.items)"
# 기대: http-server;https-server;ocpp-server;ssh-allowed

gcloud compute firewall-rules list \
  --filter="name~^ssh-allow" \
  --format="table(name,sourceRanges.list(),targetTags.list(),disabled)"
# 기대: ssh-allow-iap / ssh-allow-myip — disabled=False
```

---

## 5. Phase 2 — 검증 (반드시 Phase 3 *전* 에)

> ⚠️ **현재 SSH 세션은 절대 닫지 말고**, 새 터미널에서 두 경로를 모두 시험합니다.
> 둘 다 성공해야 Phase 3 진행. 하나라도 실패 시 광역 규칙(`default-allow-ssh`) 이 살아있는 동안 원인 파악.

### 5-A) 직접 SSH (운영자 IP 경로)

```bash
ssh jeong@34.50.12.65
# 접속 확인 후 즉시 exit
```

### 5-B) IAP 경로

```bash
gcloud compute ssh jeong@pvpentech-vm \
  --zone=asia-northeast3-a --tunnel-through-iap
# 접속 확인 후 즉시 exit
```

처음이면 다음 권한 에러가 날 수 있음 — 한 번만 처리하면 됨:

```bash
# IAP API 활성화
gcloud services enable iap.googleapis.com

# 본인 계정에 IAP 터널 사용 권한 부여
gcloud projects add-iam-policy-binding pvpentech-490312 \
  --member="user:gresystem2023@gmail.com" \
  --role="roles/iap.tunnelResourceAccessor"
```

---

## 6. Phase 3 — 광역 SSH 규칙 비활성화

**삭제가 아니라 disable** — 문제 발생 시 1초 컷 복구 가능.

```bash
gcloud compute firewall-rules update default-allow-ssh --disabled

gcloud compute firewall-rules describe default-allow-ssh \
  --format="value(disabled)"
# 기대: True
```

이 시점부터 봇은 TCP 단계에서 차단됩니다.

---

## 7. Phase 4 — 효과 확인 (VM 에서)

```bash
# 실시간 관찰 (1~2분)
sudo tail -f /var/log/auth.log
# (Ctrl+C 로 종료)

# 통계 비교
sudo journalctl -u ssh --since "5 min ago"  | grep -c "Invalid user"
sudo journalctl -u ssh --since "10 min ago" --until "5 min ago" | grep -c "Invalid user"
# Phase 3 적용 후 5분 카운트가 크게 줄어야 정상
```

며칠 운용해 문제없다고 판단되면 disabled 규칙을 삭제 처리:

```bash
gcloud compute firewall-rules delete default-allow-ssh
```

---

## 8. 운영 — IP 변경 시

집/사무실 IP 가 바뀌면:

```bash
NEW_IP=$(curl -s https://api.ipify.org)
gcloud compute firewall-rules update ssh-allow-myip \
  --source-ranges="${NEW_IP}/32"
echo "Updated to ${NEW_IP}/32"
```

또는 IAP 만 사용하고 `ssh-allow-myip` 는 제거하는 방법도 있음:

```bash
# IAP 만 쓰기로 굳히는 경우
gcloud compute firewall-rules delete ssh-allow-myip
# 이후 항상 gcloud compute ssh ... --tunnel-through-iap 로 접속
```

---

## 9. 롤백 시나리오

### 9-A) Phase 3 직후 SSH 가 안 된다

다른 PC 어디서든 (gcloud 설치되어 있으면):

```bash
# 1차: IAP 시도
gcloud compute ssh jeong@pvpentech-vm \
  --zone=asia-northeast3-a --tunnel-through-iap
```

안 되면 즉시 광역 규칙 복구:

```bash
gcloud compute firewall-rules update default-allow-ssh --no-disabled
```

### 9-B) gcloud 도 안 되는 환경에 있다

- GCP 콘솔 → **VM instances → pvpentech-vm → SSH (browser)** 버튼: 자동으로 IAP 터널 사용
- 또는 GCP 콘솔의 **Cloud Shell** 에서 위 `gcloud` 명령 실행
- 또는 **VM Serial Console** (콘솔 → VM → "Connect to serial port") — metadata SSH key 가 등록되어 있을 때

---

## 10. 보조 — fail2ban (방화벽 못 좁히는 환경에서만)

방화벽 좁히기가 본 가이드의 1순위 대책이지만, **광역 22 포트가 어쩔 수 없이 열려 있어야 하는 경우**(예: 다양한 위치에서 IAP 없이 접속) fail2ban 으로 자동 차단:

```bash
sudo apt-get install -y fail2ban
sudo systemctl enable --now fail2ban
# 기본 jail (sshd) 자동 활성화 — 5회 실패 시 10분 ban
```

본 환경(IP 좁히기 + IAP) 에서는 **불필요**.

---

## 11. 변경 이력 / 메모

- **2026-05-07**: SSH 무차별 대입 노이즈 + rsyslog `/dev/console` 루프로 `auth.log` 분석 어려움 인식
- **2026-05-08**: rsyslog `/dev/console` 라인 주석 처리 (`/etc/rsyslog.d/90-google.conf:6`) → 루프 제거
- **2026-05-08**: 본 가이드 작성 (Phase 1~4 절차 확정)

### 적용 후 체크리스트

- [ ] `ssh-allow-myip` 생성, source = 운영자 IP/32
- [ ] `ssh-allow-iap` 생성, source = `35.235.240.0/20`
- [ ] `pvpentech-vm` 에 `ssh-allowed` 태그 추가
- [ ] 직접 SSH (Phase 5-A) 검증 OK
- [ ] IAP SSH (Phase 5-B) 검증 OK
- [ ] `default-allow-ssh` disabled 처리
- [ ] `auth.log` 에 봇 시도 분당 1건 이하로 감소 확인
- [ ] 며칠 후 `default-allow-ssh` 삭제

---

## 12. 참고

- GCP IAP TCP forwarding: https://cloud.google.com/iap/docs/using-tcp-forwarding
- Default firewall rules: https://cloud.google.com/vpc/docs/firewalls#more_rules_default_vpc
- IAP source range: `35.235.240.0/20` (Google 공식 문서, 변경 시 위 링크 참조)
