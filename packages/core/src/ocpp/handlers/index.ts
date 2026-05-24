import { OcppHandler } from '../../types/ocpp.types';
import { bootNotificationHandler } from './bootNotification.handler';
import { heartbeatHandler } from './heartbeat.handler';
import { statusNotificationHandler } from './statusNotification.handler';
import { startTransactionHandler } from './startTransaction.handler';
import { stopTransactionHandler } from './stopTransaction.handler';
import { authorizeHandler } from './authorize.handler';
import { meterValuesHandler } from './meterValues.handler';
import { dataTransferHandler } from './dataTransfer.handler';
import { firmwareStatusNotificationHandler } from './firmwareStatusNotification.handler';
import { diagnosticsStatusNotificationHandler } from './diagnosticsStatusNotification.handler';

export const handlerMap = new Map<string, OcppHandler>([
  ['BootNotification', bootNotificationHandler],
  ['Heartbeat', heartbeatHandler],
  ['StatusNotification', statusNotificationHandler],
  ['StartTransaction', startTransactionHandler],
  ['StopTransaction', stopTransactionHandler],
  ['Authorize', authorizeHandler],
  ['MeterValues', meterValuesHandler],
  ['DataTransfer', dataTransferHandler],
  ['FirmwareStatusNotification', firmwareStatusNotificationHandler],
  ['DiagnosticsStatusNotification', diagnosticsStatusNotificationHandler],
]);
