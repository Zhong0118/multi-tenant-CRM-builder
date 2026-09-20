import type { AiPublicStreamEvent } from '@crm/contracts';

export class AiPublicEventQueue {
  private readonly pending: AiPublicStreamEvent[] = [];
  private waiter: ((event: AiPublicStreamEvent | undefined) => void) | null =
    null;
  private closed = false;

  push(event: AiPublicStreamEvent): void {
    if (this.closed) return;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(event);
      return;
    }
    this.pending.push(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(undefined);
    }
  }

  async next(): Promise<AiPublicStreamEvent | undefined> {
    if (this.pending.length > 0) return this.pending.shift();
    if (this.closed) return undefined;
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  takeQueued(): AiPublicStreamEvent | undefined {
    return this.pending.shift();
  }
}
