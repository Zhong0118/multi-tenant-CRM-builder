import { AI_SYSTEM_PROMPT } from './ai-orchestrator';
import { createSearchRecordsTool } from './tools/search-records.tool';
import { AssistantActionsService } from './assistant-actions';

describe('assistant action routing', () => {
  const actor = { tenantId: 't', memberId: 'm' } as never;
  const drafts = { create: jest.fn().mockResolvedValue({ id: 'draft' }) };
  const filters = {
    preview: jest.fn().mockResolvedValue({ kind: 'unavailable' }),
  };
  const actions = new AssistantActionsService(
    drafts as never,
    filters as never,
  );
  it('binds communication to the server-resolved record and rejects rewritten source', async () => {
    const tools = actions.forPage(
      actor,
      { objectCode: 'customers', recordId: 'r' },
      'turn',
      '预算还没批',
      undefined,
    );
    expect(tools.map((t) => t.name)).toEqual(['draft_communication']);
    await expect(
      tools[0].execute({ text: '确认签约' }, 'call'),
    ).rejects.toThrow();
    expect(drafts.create).not.toHaveBeenCalled();
    expect(await tools[0].execute({ text: '预算还没批' }, 'ok')).toMatchObject({
      kind: 'communication',
      draftId: 'draft',
    });
    expect(drafts.create).toHaveBeenCalledWith(actor, 'customers', 'r', {
      requestId: 'turn',
      text: '预算还没批',
    });
  });
  it('offers neutral routing instructions and forwards the original request on a custom table', async () => {
    const request = '找金额超过 10 万的商机';
    const [preview] = actions.forPage(
      actor,
      { objectCode: 'opportunities' },
      'turn',
      request,
      undefined,
    );
    const search = createSearchRecordsTool({} as never, actor);
    for (const instructions of [
      AI_SYSTEM_PROMPT,
      preview.description,
      search.description,
    ])
      expect(instructions).not.toMatch(/客户|\bcustomers?\b|\bclient brief\b/i);
    const action = await preview.execute({ text: request }, 'call');
    expect(action).toMatchObject({
      kind: 'filter',
      objectCode: 'opportunities',
    });
    expect(filters.preview).toHaveBeenCalledWith(
      actor,
      'opportunities',
      expect.objectContaining({ text: request }),
    );
  });
  it('gives list filters the current draft, without changing it', async () => {
    const currentRule = { version: 1, match: 'any', conditions: [] } as const;
    const tools = actions.forPage(
      actor,
      { objectCode: 'customers', viewId: 'v' },
      'turn',
      '找客户',
      { ...currentRule, conditions: [] },
    );
    expect(tools.map((t) => t.name)).toEqual(['preview_filter']);
    expect(await tools[0].execute({ text: '找客户' }, 'call')).toMatchObject({
      kind: 'filter',
      baseViewId: 'v',
      currentRule,
    });
  });
});
