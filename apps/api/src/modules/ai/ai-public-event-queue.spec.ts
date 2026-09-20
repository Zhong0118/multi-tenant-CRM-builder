import type { AiPublicStreamEvent } from '@crm/contracts';

import { AiPublicEventQueue } from './ai-public-event-queue';

function started(callId: string): AiPublicStreamEvent {
  return {
    event: 'tool.started',
    data: {
      callId,
      toolName: 'search_records',
      displayName: '查询记录',
      status: 'RUNNING',
    },
  };
}

function failed(callId: string): AiPublicStreamEvent {
  return {
    event: 'tool.failed',
    data: {
      callId,
      toolName: 'search_records',
      displayName: '查询记录',
      status: 'FAILED',
    },
  };
}

describe('AiPublicEventQueue', () => {
  it('keeps a pushed event after an abandoned waiter is discarded', async () => {
    const queue = new AiPublicEventQueue();
    const abandoned = queue.next();
    queue.push(started('call-1'));
    void abandoned;
    await expect(queue.next()).resolves.toEqual(started('call-1'));
  });

  it('delivers a later push to a new consumer after several microtasks', async () => {
    const queue = new AiPublicEventQueue();
    const pending = queue.next();
    void (async () => {
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
      queue.push(failed('call-1'));
    })();
    await expect(pending).resolves.toEqual(failed('call-1'));
  });
});
