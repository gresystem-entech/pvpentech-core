# 09. 충전 세션 흐름 설계 가이드

- **버전**: v1.0
- **작성일**: 2026-03-31
- **대상**: Node.js 백엔드 개발자
- **참조**: `design_ref/05_Pvpentech_API_Specification.md`, `design_ref/04_message_broker_architecture.md`

---

## 1. 개요 (Overview)

모바일 앱에서 충전기 QR 코드를 스캔하여 충전을 시작하고 종료하는 전체 흐름을 정의합니다.
OCPP 1.6 프로토콜과 REST API가 연동되는 핵심 비즈니스 플로우입니다.

---

## 2. 전체 시퀀스 다이어그램

```
앱                    CSMS Server              충전기 (CP)
 │                        │                       │
 │  POST /api/charge/start │                       │
 ├───────────────────────►│                       │
 │  (qr_code, goal_type)   │                       │
 │                         │ 1. DB: Transaction 생성│
 │                         │    status=Pending     │
 │                         │                       │
 │                         │ [2,"msgId","RemoteStartTransaction",{...}]
 │                         ├──────────────────────►│
 │                         │                       │ (처리 중)
 │  { sessionId }          │                       │
 │◄────────────────────────┤  (즉시 응답)           │
 │                         │                       │
 │  (3초마다 폴링)           │                       │
 │  GET /api/charge/status  │                       │
 ├───────────────────────►│                       │
 │  { status: "pending" }  │                       │
 │◄────────────────────────┤                       │
 │                         │                       │ 차량 연결
 │                         │  [3,"msgId",{"status":"Accepted"}]
 │                         │◄──────────────────────┤
 │                         │                       │
 │                         │  [2,"...","StartTransaction",{...}]
 │                         │◄──────────────────────┤
 │                         │ 2. DB: Transaction 업데이트
 │                         │    status=Active       │
 │                         │    ocppTransactionId   │
 │                         │  [3,"...","StartTransaction",{"transactionId":N,"idTagInfo":{"status":"Accepted"}}]
 │                         ├──────────────────────►│
 │                         │                       │
 │  GET /api/charge/status  │                       │  (MeterValues 주기적 전송)
 ├───────────────────────►│                       │◄────────────────────────
 │  { status: "active",    │                       │
 │    kwh: 3.45 }          │                       │
 │◄────────────────────────┤                       │
 │                         │                       │
 │  POST /api/charge/stop  │                       │
 ├───────────────────────►│                       │
 │                         │  [2,"msgId","RemoteStopTransaction",{...}]
 │                         ├──────────────────────►│
 │                         │  [3,"msgId",{"status":"Accepted"}]
 │                         │◄──────────────────────┤
 │                         │  [2,"...","StopTransaction",{...}]
 │                         │◄──────────────────────┤
 │                         │ 3. DB: Transaction 업데이트
 │                         │    status=Stopped      │
 │                         │    timeEnd, meterEnd   │
 │                         │    costKrw 계산         │
 │                         │  [3,"...","StopTransaction",{"idTagInfo":{"status":"Accepted"}}]
 │                         ├──────────────────────►│
 │  { kwh, cost, ... }     │                       │
 │◄────────────────────────┤                       │
```

---

## 3. 충전 세션 상태 머신

```
             POST /api/charge/start
                    │
                    ▼
              ┌──────────┐
              │ Pending  │ ──── 5분 타임아웃 ──► Failed
              └────┬─────┘      (차량 미연결)
                   │
                   │ StartTransaction 수신
                   ▼
              ┌──────────┐
              │  Active  │ ◄─── MeterValues 수신 (kwh 업데이트)
              └────┬─────┘
                   │
         ┌─────────┴──────────┐
         │                    │
         │ RemoteStop 성공     │ StopTransaction 수신
         │ (앱이 stop 요청)    │ (충전기가 자체 종료)
         ▼                    ▼
    ┌──────────┐         ┌──────────┐
    │ Stopped  │         │ Stopped  │
    └──────────┘         └──────────┘
```

---

## 4. 충전 서비스 구현 (`src/services/charge.service.ts`)

```typescript
import { prisma } from '@config/database';
import { connectionManager } from '@ocpp/connectionManager';
import { sendRemoteStartTransaction } from '@ocpp/commands/remoteStartTransaction.command';
import { sendRemoteStopTransaction } from '@ocpp/commands/remoteStopTransaction.command';
import { NotFoundError, ConflictError, UnprocessableError } from '@utils/errors';
import { logger } from '@config/logger';
import { env } from '@config/env';

interface StartChargeParams {
  qrCode: string;
  userId: string;
  goalType: 'time' | 'kwh' | 'amount' | 'free';
  goalValue?: number;
}

interface ChargeStatus {
  status: 'pending' | 'active' | 'failed';
  kwh: number;
  reason: string | null;
}

interface ChargeStopResult {
  success: boolean;
  kwh: number;
  cost: number;
  currency: string;
  message: string;
}

export class ChargeService {
  async startCharge(params: StartChargeParams): Promise<{ sessionId: string }> {
    // 1. 충전기 존재 및 활성 상태 확인
    const station = await prisma.chargingStation.findUnique({
      where: { id: params.qrCode },
      include: { site: true },
    });

    if (!station || !station.isActive) {
      throw new NotFoundError('존재하지 않는 충전기입니다.');
    }

    // 2. 동일 충전기 중복 활성 세션 방지
    const activeSession = await prisma.transaction.findFirst({
      where: {
        stationId: params.qrCode,
        status: { in: ['Pending', 'Active'] },
      },
    });

    if (activeSession) {
      throw new ConflictError('이미 사용 중인 충전기입니다.');
    }

    // 3. 충전기 연결 상태 확인
    if (!connectionManager.isConnected(params.qrCode)) {
      throw new UnprocessableError('충전기가 오프라인 상태입니다.');
    }

    // 4. 세션 ID 생성 및 DB 저장
    const sessionId = `session_${Date.now()}`;

    const transaction = await prisma.transaction.create({
      data: {
        sessionId,
        stationId: params.qrCode,
        connectorId: 1,  // 기본 커넥터 (추후 다중 커넥터 지원 시 확장)
        goalType: params.goalType as any,
        goalValue: params.goalValue,
        status: 'Pending',
      },
    });

    // 5. RemoteStartTransaction 전송 (비동기 — 응답 대기하지 않음)
    // 앱은 폴링으로 상태 확인하므로 여기서 기다릴 필요 없음
    this.sendRemoteStartAsync(params.qrCode, sessionId, transaction.id);

    logger.info({ sessionId, stationId: params.qrCode }, 'Charge session created');
    return { sessionId };
  }

  private async sendRemoteStartAsync(
    stationId: string,
    sessionId: string,
    transactionId: number
  ): Promise<void> {
    try {
      const result = await sendRemoteStartTransaction(stationId, {
        connectorId: 1,
        idTag: sessionId,  // sessionId를 idTag로 사용 (추후 RFID 연동 시 변경)
      });

      if (result.status === 'Rejected') {
        logger.warn({ sessionId, stationId }, 'RemoteStartTransaction rejected by CP');
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'Failed', failReason: 'RemoteStart rejected by charger' },
        });
      }
    } catch (error) {
      logger.error({ sessionId, stationId, error }, 'RemoteStartTransaction failed');
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'Failed', failReason: 'Communication timeout or error' },
      }).catch(() => {});
    }
  }

  async getStatus(sessionId: string): Promise<ChargeStatus | null> {
    const transaction = await prisma.transaction.findUnique({
      where: { sessionId },
      include: {
        meterValues: {
          where: { measurand: 'Energy.Active.Import.Register' },
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    if (!transaction) return null;

    if (transaction.status === 'Stopped' || transaction.status === 'Failed') {
      // 종료된 세션은 null 반환 → 앱이 404로 처리
      return null;
    }

    // 현재 kWh 계산
    const latestMeter = transaction.meterValues[0];
    const currentWh = latestMeter ? Number(latestMeter.value) : 0;
    const kwh = Math.max(0, (currentWh - transaction.meterStart) / 1000);

    return {
      status: transaction.status === 'Pending' ? 'pending' : 'active',
      kwh: Math.round(kwh * 100) / 100,  // 소수점 2자리
      reason: null,
    };
  }

  async stopCharge(sessionId: string): Promise<ChargeStopResult> {
    const transaction = await prisma.transaction.findUnique({
      where: { sessionId },
      include: { station: { include: { site: true } } },
    });

    if (!transaction || transaction.status === 'Stopped') {
      throw new NotFoundError('이미 종료되었거나 존재하지 않는 세션입니다.');
    }

    let finalKwh = 0;

    // 충전기가 연결된 경우에만 RemoteStop 전송
    if (connectionManager.isConnected(transaction.stationId) && transaction.ocppTransactionId) {
      try {
        await sendRemoteStopTransaction(transaction.stationId, {
          transactionId: transaction.ocppTransactionId,
        });
      } catch (error) {
        logger.warn({ sessionId, error }, 'RemoteStopTransaction failed, proceeding with local stop');
      }
    }

    // MeterValue에서 최종 kWh 계산
    const latestMeter = await prisma.meterValue.findFirst({
      where: {
        transactionId: transaction.id,
        measurand: 'Energy.Active.Import.Register',
      },
      orderBy: { timestamp: 'desc' },
    });

    if (latestMeter) {
      const totalWh = Number(latestMeter.value) - transaction.meterStart;
      finalKwh = Math.max(0, totalWh / 1000);
    }

    // 요금 계산 (충전소 단가 우선, 없으면 기본값)
    const unitPrice = transaction.station.site?.unitPrice
      ? Number(transaction.station.site.unitPrice)
      : env.DEFAULT_UNIT_PRICE_KRW;

    const costKrw = Math.floor(finalKwh * unitPrice);

    // DB 업데이트
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'Stopped',
        timeEnd: new Date(),
        costKrw,
      },
    });

    logger.info({ sessionId, finalKwh, costKrw }, 'Charge session stopped');

    return {
      success: true,
      kwh: Math.round(finalKwh * 100) / 100,
      cost: costKrw,
      currency: 'KRW',
      message: '충전이 완료되었습니다. 이용해 주셔서 감사합니다.',
    };
  }
}

export const chargeService = new ChargeService();
```

---

## 5. StartTransaction 핸들러 (OCPP → DB 연결)

```typescript
// src/ocpp/handlers/startTransaction.handler.ts
import { prisma } from '@config/database';
import { logger } from '@config/logger';

interface StartTransactionPayload {
  connectorId: number;
  idTag: string;
  meterStart: number;  // Wh
  timestamp: string;
}

interface StartTransactionResponse {
  transactionId: number;
  idTagInfo: { status: string };
}

export async function startTransactionHandler(
  stationId: string,
  payload: StartTransactionPayload
): Promise<StartTransactionResponse> {
  // idTag를 sessionId로 매핑 (RemoteStart 시 sessionId를 idTag로 전송)
  const transaction = await prisma.transaction.findFirst({
    where: {
      sessionId: payload.idTag,
      stationId,
      status: 'Pending',
    },
  });

  if (!transaction) {
    logger.warn({ stationId, idTag: payload.idTag }, 'No pending transaction found for StartTransaction');
    // 트랜잭션 없어도 충전기에 Accepted 응답 (새 레코드 생성)
    const newTx = await prisma.transaction.create({
      data: {
        sessionId: `ocpp_${Date.now()}`,
        stationId,
        connectorId: payload.connectorId,
        status: 'Active',
        meterStart: payload.meterStart,
        timeStart: new Date(payload.timestamp),
      },
    });
    return {
      transactionId: newTx.id,
      idTagInfo: { status: 'Accepted' },
    };
  }

  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      ocppTransactionId: transaction.id,
      status: 'Active',
      meterStart: payload.meterStart,
      timeStart: new Date(payload.timestamp),
    },
  });

  logger.info({ stationId, sessionId: payload.idTag, meterStart: payload.meterStart }, 'Transaction started');

  return {
    transactionId: transaction.id,
    idTagInfo: { status: 'Accepted' },
  };
}
```

---

## 6. 목표 달성 자동 종료 (BullMQ Job)

충전 목표(시간/kWh/금액)에 도달하면 자동으로 충전을 종료합니다.
앱은 클라이언트 측에서 목표 달성을 감지하고 `/api/charge/stop`을 호출하지만,
서버 측에서도 안전망으로 목표 달성 체크 Job을 실행합니다.

```typescript
// src/jobs/processors/chargeGoal.processor.ts
import { Job } from 'bullmq';
import { chargeService } from '@services/charge.service';
import { logger } from '@config/logger';

interface ChargeGoalJobData {
  sessionId: string;
  goalType: string;
  goalValue: number;
}

export async function chargeGoalProcessor(job: Job<ChargeGoalJobData>): Promise<void> {
  const { sessionId, goalType, goalValue } = job.data;

  const status = await chargeService.getStatus(sessionId);
  if (!status || status.status !== 'active') return;

  let shouldStop = false;

  if (goalType === 'kwh' && status.kwh >= goalValue) shouldStop = true;
  if (goalType === 'amount' && status.kwh * 250 >= goalValue) shouldStop = true;
  // time 기반은 별도 스케줄러로 처리

  if (shouldStop) {
    logger.info({ sessionId, goalType, goalValue, currentKwh: status.kwh }, 'Goal reached, stopping charge');
    await chargeService.stopCharge(sessionId);
  }
}
```

---

## 7. Pending 세션 타임아웃 처리

차량이 연결되지 않아 5분 이상 Pending 상태인 세션을 자동으로 Failed 처리합니다.

```typescript
// src/jobs/processors/sessionTimeout.processor.ts
import { prisma } from '@config/database';
import { logger } from '@config/logger';

const PENDING_TIMEOUT_MINUTES = 5;

export async function sessionTimeoutProcessor(): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MINUTES * 60 * 1000);

  const result = await prisma.transaction.updateMany({
    where: {
      status: 'Pending',
      timeStart: { lt: cutoff },
    },
    data: {
      status: 'Failed',
      failReason: '차량이 연결되지 않았습니다.',
      timeEnd: new Date(),
    },
  });

  if (result.count > 0) {
    logger.info({ count: result.count }, 'Timed out pending sessions marked as failed');
  }
}
```

---

## 8. 체크리스트

- [ ] `ChargeService.startCharge()` 구현 완료 (중복 세션 방지 포함)
- [ ] `ChargeService.getStatus()` 구현 완료 (MeterValue 기반 kWh 계산)
- [ ] `ChargeService.stopCharge()` 구현 완료 (요금 계산 포함)
- [ ] `startTransactionHandler` — DB Transaction 상태 Active 전환
- [ ] `stopTransactionHandler` — DB Transaction 상태 Stopped 전환
- [ ] `meterValuesHandler` — MeterValue DB 저장
- [ ] Pending 세션 타임아웃 Job 등록 (5분마다 실행)
- [ ] 충전 목표 달성 자동 종료 로직 구현
- [ ] RemoteStartTransaction 실패 시 Failed 상태 전환
- [ ] 요금 계산: 충전소 단가 우선, 기본값 250원/kWh 적용
