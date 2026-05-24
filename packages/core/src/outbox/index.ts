/**
 * packages/core/src/outbox/index.ts
 * Outbox 모듈 공개 API
 */

export { writeOutbox, type OutboxEventInput } from './outboxWriter';
export {
  publishEventToStream,
  moveToDeadLetter,
  STREAM_KEY,
  type PublishableEvent,
} from './streamPublisher';
export { startOutboxRelay, stopOutboxRelay } from './outboxRelay';
