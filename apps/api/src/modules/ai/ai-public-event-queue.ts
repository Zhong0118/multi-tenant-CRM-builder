import type { AiPublicStreamEvent } from '@crm/contracts';

export class AiPublicEventQueue {
  private readonly pending: AiPublicStreamEvent[] = [];
  private readonly waiters = new Set<() => void>();
  private closed = false;

  get size(): number {
    return this.pending.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  push(event: AiPublicStreamEvent): void {
    if (this.closed) return;
    this.pending.push(event);
    this.notify();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.notify();
  }

  async waitForData(): Promise<void> {
    if (this.pending.length > 0 || this.closed) return;
    await new Promise<void>((resolve) => {
      this.waiters.add(resolve);
    });
  }

  takeQueued(): AiPublicStreamEvent | undefined {
    return this.pending.shift();
  }

  private notify(): void {
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const waiter of waiters) waiter();
  }
}
