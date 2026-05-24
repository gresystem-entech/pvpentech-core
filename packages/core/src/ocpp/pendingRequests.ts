import { env } from '@pvpentech/shared/config/env';

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class PendingRequests {
  private pending = new Map<string, PendingRequest>();

  waitFor(messageId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error(`OCPP response timeout for messageId: ${messageId}`));
      }, env.OCPP_RESPONSE_TIMEOUT_MS);

      this.pending.set(messageId, { resolve, reject, timer });
    });
  }

  resolve(messageId: string, payload: unknown): void {
    const pending = this.pending.get(messageId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(messageId);
      pending.resolve(payload);
    }
  }

  reject(messageId: string, error: Error): void {
    const pending = this.pending.get(messageId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(messageId);
      pending.reject(error);
    }
  }
}

export const pendingRequests = new PendingRequests();
