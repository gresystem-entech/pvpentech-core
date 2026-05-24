// 기존 운영 명령
export { sendRemoteStartTransaction } from './remoteStartTransaction.command';
export { sendRemoteStopTransaction } from './remoteStopTransaction.command';
export { sendReset } from './reset.command';
export { sendChangeAvailability } from './changeAvailability.command';

// Phase 3 — 핵심 운영 명령 추가 (REQ-CONF-001 응답 영속화 포함)
export { sendGetConfiguration } from './getConfiguration.command';
export { sendChangeConfiguration } from './changeConfiguration.command';
export { sendClearCache } from './clearCache.command';
export { sendTriggerMessage } from './triggerMessage.command';
export { sendUnlockConnector } from './unlockConnector.command';

// Phase 4-A — 진단 + DataTransfer
export { sendGetDiagnostics } from './getDiagnostics.command';
export { sendDataTransfer } from './dataTransfer.command';

// Phase 4-B — 펌웨어 관리
export { sendUpdateFirmware } from './updateFirmware.command';

