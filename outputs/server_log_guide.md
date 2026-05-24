# Pvpentech 서버 로그 조회 가이드

- **작성일**: 2026-04-17
- **서버**: GCP VM (Ubuntu 22.04), `/opt/pvpentech`
- **프로세스 매니저**: PM2

---

## 1. PM2 로그 (가장 자주 사용)

### 기본 실시간 로그
```bash
# 모든 프로세스 실시간 로그
pm2 logs

# pvpentech 앱만 실시간
pm2 logs pvpentech

# 최근 N줄 출력 후 실시간 팔로우
pm2 logs pvpentech --lines 200
```

### stdout / stderr 분리
```bash
# 일반 로그만
pm2 logs pvpentech --out

# 에러 로그만
pm2 logs pvpentech --err

# 에러 최근 100줄
pm2 logs pvpentech --err --lines 100
```

### PM2 로그 파일 직접 접근
```bash
# 로그 파일 경로 확인
pm2 info pvpentech | grep log

# 직접 tail
tail -f ~/.pm2/logs/pvpentech-out.log
tail -f ~/.pm2/logs/pvpentech-error.log

# 로그 디렉토리 목록
ls -lh ~/.pm2/logs/
```

---

## 2. 키워드 / 패턴 검색

```bash
# 충전기 ID로 추적
pm2 logs pvpentech --lines 500 | grep "EN901954"

# 에러 키워드 검색
grep "ERROR" ~/.pm2/logs/pvpentech-error.log | tail -50

# 특정 날짜 로그
grep "2026-04-17" ~/.pm2/logs/pvpentech-out.log | tail -100

# 에러 발생 전후 5줄씩 맥락 보기
grep -A 5 -B 5 "error" ~/.pm2/logs/pvpentech-error.log | tail -100
```

### OCPP / 충전 흐름 추적
```bash
# OCPP 연결 이벤트
pm2 logs pvpentech --lines 500 | grep -E "BootNotification|Heartbeat|connected|disconnected"

# 충전 시작/종료
pm2 logs pvpentech --lines 1000 | grep -E "StartTransaction|StopTransaction|RemoteStart|RemoteStop"

# 특정 충전기 전체 흐름
grep "EN300140" ~/.pm2/logs/pvpentech-out.log | tail -100
```

---

## 3. Nginx 로그

```bash
# 실시간 HTTP 액세스 로그
sudo tail -f /var/log/nginx/access.log

# 에러 로그 (502, 연결 실패 등)
sudo tail -f /var/log/nginx/error.log

# WebSocket 업그레이드 요청만 필터
sudo grep "101 Switching" /var/log/nginx/access.log | tail -20

# 특정 경로 요청 필터
sudo grep "POST /auths" /var/log/nginx/access.log | tail -20

# 4xx/5xx 에러만
sudo grep -E '" [45][0-9]{2} ' /var/log/nginx/access.log | tail -50
```

---

## 4. 로그 구조 이해 (pino JSON 로그)

서버 로그는 JSON 형식(pino)으로 출력됩니다.

```json
{
  "level": 30,          // 10=trace 20=debug 30=info 40=warn 50=error
  "time": 1776422678468,
  "service": "pvpentech-csms",
  "method": "POST",
  "path": "/api/charge/start",
  "statusCode": 200,
  "duration": 45,       // ms
  "ip": "::ffff:1.2.3.4",
  "msg": "HTTP request"
}
```

| level 값 | 의미 |
|----------|------|
| 30 | INFO (정상) |
| 40 | WARN (경고) |
| 50 | ERROR (에러) |

### JSON 로그 가독성 향상 (pino-pretty 설치된 경우)
```bash
pm2 logs pvpentech --lines 100 | npx pino-pretty
```

---

## 5. 404 / 라우트 미등록 오류 진단

로그에서 `"statusCode": 404`가 보이면:

```bash
# 404 발생 경로 모아보기
grep '"statusCode":404' ~/.pm2/logs/pvpentech-out.log | tail -30
```

**주요 원인**:
- 클라이언트(모바일 앱, 충전기)가 존재하지 않는 경로 호출
- FastAPI/Django 시절 경로를 그대로 사용 중

**현재 등록된 주요 경로 그룹**:
```
/api/*                             모바일 앱 인증/충전
/auths                             충전기 프로비저닝
/api/portal/cs/*                   CS 포털 API
/api/portal/partner/*              파트너 포털 API
/api/portal/customer/*             고객 포털 API
/api/admin/stations/:id/*          OCPP 원격 제어
```

---

## 6. PM2 상태 / 재시작

```bash
# 프로세스 상태 확인
pm2 status

# 재시작
pm2 restart pvpentech

# 로그 초기화 (파일 비우기)
pm2 flush

# 앱 중지 / 시작
pm2 stop pvpentech
pm2 start pvpentech
```

---

## 7. 실시간 모니터링 대시보드

```bash
# PM2 웹 대시보드 (CPU, 메모리, 로그 통합)
pm2 monit
```
