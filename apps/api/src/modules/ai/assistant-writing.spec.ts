import { AssistantActionsService } from './assistant-actions';
import { persistedAction } from './assistant-turn-tools';
it('rejects an unverified chat target and model-invented supplement; stores only non-body status', async () => {
  const drafts = {
    write: jest.fn().mockResolvedValue({
      kind: 'message',
      blocks: [{ text: 'private body', factRefs: [] }],
      generatedAt: 'date',
      title: 'private title',
    }),
  };
  const actions = new AssistantActionsService(
    {} as never,
    {} as never,
    drafts as never,
  );
  const tool = actions.writingTool(
    {} as never,
    '请写微信',
    { aborted: false } as never,
    (_code, id) => id === '018f47a2-4b5c-7d8e-9f01-000000000001',
  );
  const request = {
    objectCode: 'leads',
    recordId: '018f47a2-4b5c-7d8e-9f01-000000000001',
    options: {
      kind: 'message',
      purpose: 'followup',
      tone: 'friendly',
      length: 'short',
    },
  };
  await expect(
    tool!.execute({
      ...request,
      recordId: '018f47a2-4b5c-7d8e-9f01-000000000002',
    }),
  ).rejects.toThrow();
  await expect(
    tool!.execute({
      ...request,
      options: { ...request.options, supplement: 'invented' },
    }),
  ).rejects.toThrow();
  const action = await tool!.execute(request);
  expect(JSON.stringify(action)).toContain('private body');
  expect(JSON.stringify(persistedAction(action))).not.toContain('private');
});
