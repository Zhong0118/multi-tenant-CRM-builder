import { z } from 'zod';
import { VercelOpenAiProvider } from '../providers/vercel-openai.provider';
import {
  discoverModels,
  testModel,
  type RuntimeModelSnapshot,
} from './model-runtime';

const snapshot: RuntimeModelSnapshot = {
  purpose: 'text',
  provider: 'Example',
  providerId: 'p',
  revisionId: 'r',
  assignmentVersion: 1,
  model: 'trial',
  protocol: 'chat',
  baseURL: 'https://models.example/v1',
  apiKey: 'private-test-key',
  contextTokens: 64000,
  maxOutputTokens: 16000,
  inputPrice: null,
  outputPrice: null,
  currency: null,
};
type ChatMessage = {
  role: string;
  content: string | null;
  tool_calls?: unknown[];
};
function chat(message: ChatMessage, finish_reason = 'stop') {
  return Response.json({
    id: 'mock',
    object: 'chat.completion',
    created: 1,
    model: 'trial',
    choices: [{ index: 0, message, finish_reason }],
    usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
  });
}
function mockUpstream(
  run: (
    url: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>,
) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url, init) => Promise.resolve(run(url, init)));
}
function readBody(init: RequestInit | undefined) {
  if (typeof init?.body !== 'string')
    throw new Error('Expected a serialized model request');
  return JSON.parse(init.body) as {
    model: string;
    stream?: boolean;
    tools?: unknown;
    thinking?: { type: string };
    tool_choice?: unknown;
    response_format?: {
      type: string;
      json_schema?: { schema: { properties: unknown } };
    };
    messages: {
      role: string;
      content: string | { type: string; text?: string }[];
    }[];
  };
}
afterEach(() => jest.restoreAllMocks());
it('discovers unique public model IDs without interpreting discovery as a test', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      Response.json({ data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }),
    );
  expect(await discoverModels(snapshot)).toEqual(['a', 'b']);
  expect(fetch.mock.calls[0][0]).toBe(snapshot.baseURL + '/models');
});
it('sends fixed text, a validated named tool, and the production communication schema through Chat', async () => {
  const mock = mockUpstream((url, init) => {
    expect(url).toBe(snapshot.baseURL + '/chat/completions');
    const body = readBody(init);
    expect(body.model).toBe('trial');
    if (body.tools)
      return chat(
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'confirm_code',
                arguments: '{"code":"CRM-42"}',
              },
            },
          ],
        },
        'tool_calls',
      );
    if (body.response_format) {
      expect(
        body.response_format.json_schema?.schema.properties,
      ).toHaveProperty('fieldChanges');
      return chat({
        role: 'assistant',
        content: JSON.stringify({
          note: '客户已收到报价。',
          followUp: null,
          fieldChanges: [],
        }),
      });
    }
    return chat({ role: 'assistant', content: 'OK' });
  });
  const report = await testModel(snapshot);
  expect(report).toMatchObject({
    errorCode: null,
    inputTokens: 33,
    outputTokens: 9,
  });
  expect(report.steps.map((step) => step.ok)).toEqual([true, true, true]);
  expect(mock).toHaveBeenCalledTimes(3);
});
it('rejects text in place of a tool call, and returns no secret or upstream body', async () => {
  mockUpstream(() => chat({ role: 'assistant', content: 'OK' }));
  const report = await testModel(snapshot);
  expect(report.steps.find((s) => s.name === 'tool')).toMatchObject({
    ok: false,
  });
  expect(JSON.stringify(report)).not.toContain(snapshot.apiKey);
});
it.each([
  [0, 1, true],
  [1, 0, false],
  [0, 0, false],
])('checks embedding row indexes %i,%i', async (i, j, valid) => {
  mockUpstream((url) => {
    expect(url).toBe(snapshot.baseURL + '/embeddings');
    return Response.json({
      object: 'list',
      model: 'trial',
      data: [
        { index: i, embedding: [1, 2] },
        { index: j, embedding: [2, 1] },
      ],
      usage: { prompt_tokens: 4, total_tokens: 4 },
    });
  });
  const report = await testModel({ ...snapshot, purpose: 'embedding' });
  expect(report.steps[0].ok).toBe(valid);
  expect(report.dimensions).toBe(valid ? 2 : null);
});
it('puts only the image in the visual input and checks the recognized text', async () => {
  mockUpstream((_, init) => {
    const body = readBody(init);
    const content = body.messages[0].content;
    expect(content).toContainEqual(
      expect.objectContaining({ type: 'image_url' }),
    );
    if (!Array.isArray(content)) throw new Error('Expected image parts');
    expect(
      content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join(''),
    ).not.toContain('A724');
    return chat({ role: 'assistant', content: 'A724' });
  });
  expect(
    (await testModel({ ...snapshot, purpose: 'vision' })).errorCode,
  ).toBeNull();
});

it('uses DeepSeek Chat JSON mode with the production schema and non-thinking tool requests', async () => {
  mockUpstream((_, init) => {
    const b = readBody(init);
    if (b.thinking?.type !== 'disabled')
      return new Response(null, { status: 400 });
    if (b.tools)
      return chat(
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call',
              type: 'function',
              function: {
                name: 'confirm_code',
                arguments: '{"code":"CRM-42"}',
              },
            },
          ],
        },
        'tool_calls',
      );
    if (b.response_format) {
      if (
        b.response_format.type !== 'json_object' ||
        !b.messages.some(
          (m) =>
            m.role === 'system' &&
            typeof m.content === 'string' &&
            m.content.includes('fieldChanges'),
        )
      )
        return new Response(null, { status: 400 });
      return chat({
        role: 'assistant',
        content: JSON.stringify({
          note: '客户已收到报价。',
          followUp: null,
          fieldChanges: [],
        }),
      });
    }
    return chat({ role: 'assistant', content: 'OK' });
  });
  expect(
    (
      await testModel({
        ...snapshot,
        provider: 'deepseek',
        baseURL: 'https://api.deepseek.com',
      })
    ).errorCode,
  ).toBeNull();
});

it('requires an actual named tool call in DeepSeek Responses auto mode', async () => {
  mockUpstream((_, init) => {
    const body = readBody(init);
    if (!body.tools || body.tool_choice !== 'auto')
      return new Response(null, { status: 400 });
    return Response.json({
      id: 'r1',
      created_at: 1,
      model: 'trial',
      output: [
        {
          type: 'function_call',
          id: 'f1',
          call_id: 'c1',
          name: 'confirm_code',
          arguments: '{"code":"CRM-42"}',
        },
      ],
      usage: { input_tokens: 8, output_tokens: 4 },
    });
  });
  const report = await testModel({
    ...snapshot,
    protocol: 'responses',
    baseURL: 'https://api.deepseek.com',
  });
  expect(report.steps.find((s) => s.name === 'tool')).toMatchObject({
    ok: true,
  });
});

it.each(['chat', 'responses'] as const)(
  'streams usage and completion using the selected %s protocol',
  async (protocol) => {
    const controller = new AbortController();
    const mock = mockUpstream((url, init) => {
      const body = readBody(init);
      expect(body.model).toBe('trial');
      expect(body.stream).toBe(true);
      expect(url).toBe(
        snapshot.baseURL +
          (protocol === 'chat' ? '/chat/completions' : '/responses'),
      );
      const chunk = {
        id: 'c1',
        model: 'trial',
        created: 1,
        object: 'chat.completion.chunk',
      };
      const item = { type: 'message', id: 'm1' };
      const events =
        protocol === 'chat'
          ? [
              {
                ...chunk,
                choices: [
                  {
                    index: 0,
                    delta: { role: 'assistant', content: 'OK' },
                    finish_reason: null,
                  },
                ],
              },
              {
                ...chunk,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: {
                  prompt_tokens: 9,
                  completion_tokens: 2,
                  total_tokens: 11,
                },
              },
            ]
          : [
              {
                type: 'response.created',
                response: { id: 'r', created_at: 1, model: 'trial' },
              },
              { type: 'response.output_item.added', output_index: 0, item },
              {
                type: 'response.output_text.delta',
                output_index: 0,
                item_id: 'm1',
                delta: 'OK',
              },
              { type: 'response.output_item.done', output_index: 0, item },
              {
                type: 'response.completed',
                response: { usage: { input_tokens: 9, output_tokens: 2 } },
              },
            ];
      return new Response(
        events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const provider = new VercelOpenAiProvider({
      ...snapshot,
      modelKey: snapshot.model,
      protocol,
    });
    const events = [];
    for await (const e of provider.streamTurn({
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [],
      system: 'Answer',
      abortSignal: controller.signal,
    }))
      events.push(e);
    expect(events).toContainEqual({
      type: 'USAGE',
      inputTokens: 9,
      outputTokens: 2,
    });
    expect(events.at(-1)).toEqual({ type: 'COMPLETED' });
    expect(mock).toHaveBeenCalledTimes(1);
  },
);

it('propagates cancellation into the SDK fetch and finishes with a safe code', async () => {
  const cancel = new AbortController();
  mockUpstream((_, init) => {
    const signal = init?.signal;
    expect(signal).toBeTruthy();
    const wait = new Promise<Response>((_, reject) =>
      signal!.addEventListener(
        'abort',
        () => reject(new Error('Caller cancelled')),
        {
          once: true,
        },
      ),
    );
    cancel.abort();
    return wait;
  });
  const report = await testModel(snapshot, cancel.signal);
  expect(report.errorCode).toBe('CANCELLED');
  expect(report.steps).toHaveLength(3);
  expect(report.steps.every((s) => !s.ok)).toBe(true);
});

it('enforces an overall deadline even for an endless provider stream', async () => {
  const old = process.env.AI_TIMEOUT_MS;
  process.env.AI_TIMEOUT_MS = '30';
  const caller = new AbortController();
  const fallback = setTimeout(() => caller.abort(), 500);
  const observed: unknown[] = [];
  mockUpstream((_, init) => {
    return new Response(
      new ReadableStream({
        start(controller) {
          init!.signal!.addEventListener(
            'abort',
            () => controller.error(init!.signal!.reason),
            { once: true },
          );
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  try {
    const provider = new VercelOpenAiProvider({
      ...snapshot,
      modelKey: 'trial',
      protocol: 'chat',
    });
    for await (const e of provider.streamTurn({
      messages: [{ role: 'user', content: 'Hi' }],
      system: 'test',
      tools: [],
      abortSignal: caller.signal,
    }))
      observed.push(e);
    expect(observed.at(-1)).toEqual({
      type: 'FAILED',
      code: 'AI_PROVIDER_TIMEOUT',
    });
    expect(caller.signal.aborted).toBe(false);
  } finally {
    clearTimeout(fallback);
    if (old === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = old;
  }
});

it('retains safe status and codes for invalid credentials and hides upstream messages', async () => {
  const mock = mockUpstream(
    () => new Response('private-test-key do not forward', { status: 401 }),
  );
  const report = await testModel(snapshot);
  expect(
    report.steps.every(
      (s) => s.httpStatus === 401 && s.errorCode === 'CREDENTIAL_REJECTED',
    ),
  ).toBe(true);
  expect(JSON.stringify(report)).not.toContain('private-test-key');
  await expect(discoverModels(snapshot)).rejects.toMatchObject({
    code: 'CREDENTIAL_REJECTED',
    httpStatus: 401,
  });
  expect(mock).toHaveBeenCalledTimes(4);
});

it.each([
  ['daily_brief', 'https://api.deepseek.com', true],
  ['writing', 'https://api.deepseek.com', false],
  ['daily_brief', 'https://other.example', false],
] as const)(
  'sends the configured reasoning mode for %s to %s',
  async (feature, baseURL, disableThinking) => {
    const fetchSpy = mockUpstream(() => new Response(null, { status: 400 }));
    const provider = new VercelOpenAiProvider({
      apiKey: 'test',
      modelKey: 'deepseek-flash',
      baseURL,
      protocol: 'responses',
    });
    await expect(
      provider.generateSalesDaily({
        actor: {} as never,
        feature,
        system: 'Fixture',
        prompt: '{}',
        schema: z.object({}),
      }),
    ).rejects.toBeDefined();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as {
      reasoning?: unknown;
      input: { role: string }[];
    };
    expect(body.reasoning).toEqual(
      disableThinking ? { effort: 'none' } : undefined,
    );
    expect(body.input[0].role).toBe('system');
  },
);

it.each(['default', 'none'] as const)(
  'makes one import mapping request with %s reasoning',
  async (mode) => {
    const send = mockUpstream(() => new Response(null, { status: 400 }));
    const provider = new VercelOpenAiProvider({
      apiKey: 'fixture',
      modelKey: 'deepseek-flash',
      baseURL: 'https://api.deepseek.com',
      protocol: 'responses',
    });
    await expect(
      provider.generateImportAssist(
        {
          sheet: '商机',
          currentHeader: 1,
          headerLocked: true,
          fields: [],
          candidates: [],
        },
        {} as never,
        new AbortController().signal,
        mode,
      ),
    ).rejects.toBeDefined();
    expect(send).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(send.mock.calls[0][1]?.body)) as {
      reasoning?: unknown;
      max_output_tokens: number;
    };
    expect(body.reasoning).toEqual(
      mode === 'none' ? { effort: 'none' } : undefined,
    );
    expect(body.max_output_tokens).toBe(4000);
  },
);
