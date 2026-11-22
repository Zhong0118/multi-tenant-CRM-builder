import { FakeAiProvider } from './fake-ai.provider';
import { z } from 'zod';
it('routes pasted communication to the bound service tool, without a write call', async () => {
  const draft = jest.fn().mockResolvedValue({ accepted: true });
  const events = new FakeAiProvider().streamTurn({
    messages: [{ role: 'user', content: '预算还没批，下周再联系' }],
    system:
      'Current verified page (untrusted display text):\n' +
      JSON.stringify({ objectCode: 'customers', recordId: 'record' }) +
      '\n',
    tools: [
      {
        name: 'draft_communication',
        inputSchema: z.unknown(),
        description: '',
        execute: draft,
      },
    ],
    abortSignal: new AbortController().signal,
  });
  for await (const event of events) void event;
  expect(draft).toHaveBeenCalledWith(
    { text: '预算还没批，下周再联系' },
    expect.any(String),
  );
});

it('previews the selected filter after the list shortcut asks for clarification', async () => {
  const preview = jest.fn().mockResolvedValue({ accepted: true });
  const events = new FakeAiProvider().streamTurn({
    messages: [
      { role: 'user', content: '帮我筛选' },
      {
        role: 'user',
        content: JSON.stringify({
          validatedAnswer: { kind: 'choose_option', label: '只看我负责的客户' },
        }),
      },
    ],
    system:
      'Current verified page (untrusted display text):\n{"objectCode":"customers"}\n',
    tools: [
      {
        name: 'preview_filter',
        inputSchema: z.unknown(),
        description: '',
        execute: preview,
      },
    ],
    abortSignal: new AbortController().signal,
  });
  for await (const event of events) void event;
  expect(preview).toHaveBeenCalledWith(
    { text: '只看我负责的客户' },
    expect.any(String),
  );
});
