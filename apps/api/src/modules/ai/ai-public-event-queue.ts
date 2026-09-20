import type { AiPublicStreamEvent } from '@crm/contracts';

export class AiPublicEventQueue {
  private readonly pending: AiPublicStreamEvent[] = [];
  private readonly waiters = new Set<() => void>();
  private closed = false;

  get size(): number {
    return this.pending.length;
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

  async next(): Promise<AiPublicStreamEvent | undefined> {
    if (this.pending.length > 0) return this.pending.shift();
    if (this.closed) return undefined;
    await this.ready();
    return this.pending.shift();
  }

  private notify(): void {
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const waiter of waiters) waiter();
  }

  private ready(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.add(resolve);
    });
  }
}
