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
  it('does not let an abandoned waiter consume a later event', async () => {
    const queue = new AiPublicEventQueue();
    const abandoned = queue.waitForData();
    queue.push(started('call-1'));
    await Promise.resolve();
    await Promise.resolve();
    void abandoned;
    expect(queue.takeQueued()).toEqual(started('call-1'));
    expect(queue.takeQueued()).toBeUndefined();
  });

  it('wakes a waiter without giving it the event', async () => {
    const queue = new AiPublicEventQueue();
    const pending = queue.waitForData();
    void (async () => {
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
      queue.push(failed('call-1'));
    })();
    await pending;
    expect(queue.takeQueued()).toEqual(failed('call-1'));
  });
});
