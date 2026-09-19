import { z } from 'zod';

import type { AiPublicStreamEvent } from '@crm/contracts';
import { ApiException } from '../../common/errors/api.exception';
import type { AiProviderTool } from './ai-provider';
import { AiTurnBudget } from './ai-turn-budget';
import { wrapAiReadTool, type AiToolCallbacks } from './ai-tool-wrapper';

function callbacks(overrides: Partial<AiToolCallbacks> = {}) {
  const events: AiPublicStreamEvent[] = [];
  const budget = overrides.budget ?? new AiTurnBudget();
  const abortSignal = overrides.abortSignal ?? new AbortController().signal;
  const toolSummaries = overrides.toolSummaries ?? [];
  const sources = overrides.sources ?? [];
  return {
    events,
    toolSummaries,
    sources,
    callbacks: {
      emit: (event: AiPublicStreamEvent) => events.push(event),
      budget,
      abortSignal,
      toolSummaries,
      sources,
      ...overrides,
    } satisfies AiToolCallbacks,
  };
}

function searchTool(execute: AiProviderTool['execute']): AiProviderTool {
  return {
    name: 'search_records',
    description: 'search',
    inputSchema: z
      .object({
        objectCode: z.string(),
        limit: z.number().int().min(1).max(20).default(10),
      })
      .strict(),
    execute,
  };
}

describe('wrapAiReadTool', () => {
  it('emits business-Chinese tool.started, sources.updated, and tool.completed without raw values', async () => {
    const { events, callbacks: cb, toolSummaries, sources } = callbacks();
    const wrapped = wrapAiReadTool(
      searchTool(async () => ({
        items: [
          {
            id: 'rec-1',
            title: '自己的线索',
            values: { name: '自己的线索', secret: '内部备注' },
          },
        ],
        total: 1,
      })),
      cb,
    );

    const result = await wrapped.execute(
      { objectCode: 'leads', limit: 20 },
      'call-1',
    );

    expect(events.map((event) => event.event)).toEqual([
      'tool.started',
      'sources.updated',
      'tool.completed',
    ]);
    expect(events[0]).toEqual({
      event: 'tool.started',
      data: {
        callId: 'call-1',
        toolName: 'search_records',
        displayName: '查询leads记录',
        status: 'RUNNING',
      },
    });
    expect(events[1]).toEqual({
      event: 'sources.updated',
      data: {
        sources: [
          {
            kind: 'RECORDS',
            objectCode: 'leads',
            objectName: 'leads',
            count: 1,
          },
        ],
      },
    });
    expect(JSON.stringify(events)).not.toContain('内部备注');
    expect(JSON.stringify(events)).not.toContain('"values"');
    expect(result).toEqual({
      items: [
        {
          id: 'rec-1',
          title: '自己的线索',
          values: { name: '自己的线索', secret: '内部备注' },
        },
      ],
      total: 1,
    });
    expect(toolSummaries.at(-1)?.status).toBe('COMPLETED');
    expect(sources).toHaveLength(1);
  });

  it('returns DATA_UNAVAILABLE to the provider on non-fatal read failure and still emits tool.failed', async () => {
    const { events, callbacks: cb } = callbacks();
    const wrapped = wrapAiReadTool(
      searchTool(async () => {
        throw new ApiException('RECORD_NOT_FOUND', 404);
      }),
      cb,
    );

    await expect(
      wrapped.execute({ objectCode: 'leads', limit: 5 }, 'call-fail'),
    ).resolves.toEqual({ unavailable: true, code: 'DATA_UNAVAILABLE' });
    expect(events.map((event) => event.event)).toEqual([
      'tool.started',
      'tool.failed',
    ]);
    expect(events[1]).toMatchObject({
      event: 'tool.failed',
      data: {
        callId: 'call-fail',
        toolName: 'search_records',
        displayName: '查询leads记录',
        status: 'FAILED',
      },
    });
    expect(JSON.stringify(events)).not.toContain('RECORD_NOT_FOUND');
  });

  it('does not start a new tool after abort and does not call the domain tool', async () => {
    const abort = new AbortController();
    abort.abort();
    const execute = jest.fn();
    const { events, callbacks: cb } = callbacks({ abortSignal: abort.signal });
    const wrapped = wrapAiReadTool(searchTool(execute), cb);
    await expect(
      wrapped.execute({ objectCode: 'leads' }, 'call-abort'),
    ).resolves.toEqual({ unavailable: true, code: 'DATA_UNAVAILABLE' });
    expect(execute).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('strips secret keys before the provider sees the tool result', async () => {
    const { callbacks: cb } = callbacks();
    const wrapped = wrapAiReadTool(
      searchTool(async () => ({
        title: '可见',
        apiKey: 'sk-live',
        values: { name: '客户', passwordHash: 'x' },
      })),
      cb,
    );
    await expect(
      wrapped.execute({ objectCode: 'leads' }, 'call-san'),
    ).resolves.toEqual({
      title: '可见',
      values: { name: '客户' },
    });
  });

  it('returns DATA_UNAVAILABLE when a tool payload would exceed 80 KiB', async () => {
    const { events, callbacks: cb } = callbacks();
    const wrapped = wrapAiReadTool(
      searchTool(async () => ({
        items: Array.from({ length: 50 }, (_, index) => ({
          id: `rec-${index}`,
          title: 'x'.repeat(2000),
        })),
      })),
      cb,
    );
    await expect(
      wrapped.execute({ objectCode: 'leads' }, 'call-huge'),
    ).resolves.toEqual({ unavailable: true, code: 'DATA_UNAVAILABLE' });
    expect(events.map((event) => event.event)).toEqual([
      'tool.started',
      'tool.failed',
    ]);
    expect(JSON.stringify(events)).not.toContain('"blob"');
  });

  it('does not let prompt-injection text in record values change the tool schema', async () => {
    const { callbacks: cb } = callbacks();
    const wrapped = wrapAiReadTool(
      searchTool(async (input) => ({ echoed: input })),
      cb,
    );
    expect(
      wrapped.inputSchema.safeParse({
        objectCode: 'leads',
        tenantId: 'other-tenant',
        includeHidden: true,
      }).success,
    ).toBe(false);
    await wrapped.execute({ objectCode: 'leads' }, 'call-inject');
    expect(wrapped.inputSchema.safeParse({ objectCode: 'leads' }).success).toBe(
      true,
    );
  });

  it('returns INVALID_TOOL_ARGUMENT to the provider on schema parse failure without leaking args', async () => {
    const { events, callbacks: cb } = callbacks();
    const execute = jest.fn();
    const wrapped = wrapAiReadTool(searchTool(execute), cb);

    await expect(
      wrapped.execute(
        {
          objectCode: 'leads',
          tenantId: 'other-tenant',
          includeHidden: true,
        },
        'call-invalid',
      ),
    ).resolves.toEqual({ unavailable: true, code: 'INVALID_TOOL_ARGUMENT' });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.event)).toEqual([
      'tool.started',
      'tool.failed',
    ]);
    expect(events[1]).toMatchObject({
      event: 'tool.failed',
      data: {
        callId: 'call-invalid',
        toolName: 'search_records',
        status: 'FAILED',
      },
    });
    expect(JSON.stringify(events)).not.toContain('other-tenant');
    expect(JSON.stringify(events)).not.toContain('includeHidden');
    expect(JSON.stringify(events)).not.toContain('tenantId');
  });

  it('uses published objectName from the sanitized result when present', async () => {
    const { events, callbacks: cb } = callbacks();
    const wrapped = wrapAiReadTool(
      searchTool(async () => ({
        objectName: '线索',
        items: [{ id: 'rec-1', title: '自己的线索' }],
        total: 1,
      })),
      cb,
    );

    await wrapped.execute({ objectCode: 'leads', limit: 20 }, 'call-named');

    expect(events[0]).toMatchObject({
      event: 'tool.started',
      data: { displayName: '查询leads记录', status: 'RUNNING' },
    });
    expect(events[1]).toEqual({
      event: 'sources.updated',
      data: {
        sources: [
          {
            kind: 'RECORDS',
            objectCode: 'leads',
            objectName: '线索',
            count: 1,
          },
        ],
      },
    });
    expect(JSON.stringify(events)).not.toContain('销售线索');
    expect(JSON.stringify(events)).not.toContain('商机');
  });

  it('emits tool.failed when abort fires after tool.started so the summary is not left RUNNING', async () => {
    const abort = new AbortController();
    const { events, callbacks: cb, toolSummaries } = callbacks({
      abortSignal: abort.signal,
    });
    const wrapped = wrapAiReadTool(
      searchTool(async () => {
        abort.abort();
        return { items: [{ id: 'rec-1', title: '自己的线索' }], total: 1 };
      }),
      cb,
    );

    await expect(
      wrapped.execute({ objectCode: 'leads', limit: 5 }, 'call-inflight'),
    ).resolves.toEqual({ unavailable: true, code: 'DATA_UNAVAILABLE' });
    expect(events.map((event) => event.event)).toEqual([
      'tool.started',
      'tool.failed',
    ]);
    expect(events[1]).toEqual({
      event: 'tool.failed',
      data: {
        callId: 'call-inflight',
        toolName: 'search_records',
        displayName: '查询leads记录',
        status: 'FAILED',
      },
    });
    expect(toolSummaries.at(-1)?.status).toBe('FAILED');
    expect(JSON.stringify(events)).not.toContain('自己的线索');
  });
});
