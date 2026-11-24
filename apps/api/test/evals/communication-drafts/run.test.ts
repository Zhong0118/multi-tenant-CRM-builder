import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createAiProvider } from '../../../src/modules/ai/ai-provider';
import { cases } from './cases';
import { evaluate } from './run';
import { providerSettings, renderReport, type CaseResult } from './report';

void test('an ordinary run ignores application provider settings and cannot use the network', () => {
  assert.deepEqual(
    providerSettings({
      NODE_ENV: 'production',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'example',
      AI_API_KEY: 'unused',
    }),
    { nodeEnv: 'test', provider: 'fake' },
  );
});

void test('real requests require explicit opt-in, an identified model and a local key, and are blocked in CI', () => {
  const real = {
    COMMUNICATION_EVAL_PROVIDER: 'real',
    AI_MODEL: 'example-model',
    AI_API_KEY: 'local-test-value',
  };
  assert.equal(providerSettings(real).provider, 'openai');
  assert.throws(() => providerSettings({ ...real, CI: 'true' }), /CI/);
  assert.throws(
    () => providerSettings({ ...real, AI_API_KEY: '' }),
    /AI_API_KEY/,
  );
  assert.throws(() => providerSettings({ ...real, AI_MODEL: ' ' }), /AI_MODEL/);
  assert.throws(
    () => providerSettings({ COMMUNICATION_EVAL_PROVIDER: 'typo' }),
    /COMMUNICATION_EVAL_PROVIDER/,
  );
});

void test('report includes failed input, raw and validated drafts, scores transport errors as failures, and redacts credentials', () => {
  const secret = 'redaction-test-sentinel';
  const common = {
    category: '日期',
    text: '下周三联系',
    expected: {},
    modelOutput: { note: secret },
    draft: { note: '联系客户' },
  };
  const rows: CaseResult[] = [
    { ...common, id: 'pass', failures: [] },
    { ...common, id: 'fail', failures: ['缺少跟进'] },
    {
      ...common,
      id: 'provider',
      modelOutput: null,
      draft: null,
      failures: ['AI_PROVIDER_UNAVAILABLE'],
    },
  ];
  const report = renderReport('fake', rows, secret);
  assert.match(report, /1\/3/);
  assert.match(report, /下周三联系/);
  assert.match(report, /缺少跟进/);
  assert.match(report, /AI_PROVIDER_UNAVAILABLE/);
  assert.match(report, /联系客户/);
  assert.match(report, /\[REDACTED\]/);
  assert.ok(!report.includes(secret));
});

void test('the configured SDK uses the structured Responses API and the evaluator scores the server-validated draft', async (t) => {
  const sample = cases.find((c) => c.id === 'next-week')!;
  const raw = {
    note: '预算待批，下周联系。',
    followUp: {
      title: '回访',
      dateExpression: { kind: 'weekday', week: 'next', weekday: 1, time: null },
      evidence: '下周再联系',
    },
    fieldChanges: [],
  };
  let requestBody = '';
  let path = '';
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      path = new URL(String(input)).pathname;
      requestBody = String(init?.body);
      return Response.json({
        id: 'resp_eval',
        object: 'response',
        model: 'transport-fixture',
        status: 'completed',
        created_at: 1,
        output: [
          {
            type: 'message',
            id: 'msg_eval',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify(raw),
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      });
    },
  );
  const provider = createAiProvider({
    nodeEnv: 'development',
    provider: 'openai',
    apiKey: randomUUID(),
    model: 'transport-fixture',
    baseURL: 'https://models.example/v1',
  });
  const [row] = await evaluate(provider, [sample]);
  assert.equal(path, '/v1/responses');
  assert.match(requestBody, /json_schema/);
  // DeepSeek rejects the JSON Schema date format before it runs the model.
  assert.doesNotMatch(requestBody, /"format"\s*:\s*"date"/);
  assert.ok(requestBody.includes(sample.text));
  assert.deepEqual(row.failures, []);
  assert.deepEqual(row.modelOutput, raw);
  assert.equal(row.draft?.followUp?.suggestedDate, sample.expected.date);
});

void test('a fresh report also surfaces passing notes for a repeatable qualitative review', () => {
  const report = renderReport('fake', [
    {
      id: 'next-week',
      category: '明确时间',
      text: '客户预算还没批，下周再联系。',
      draft: { note: '预算待批，约定下周回访。' },
      modelOutput: null,
      expected: {},
      failures: [],
    },
  ]);
  for (const term of ['忠实', '简洁', '编造', '预算待批，约定下周回访。'])
    assert.ok(report.includes(term), term);
});

void test('the offline development run exercises the complete generator and preserves the scripted local sale', async () => {
  const rows = await evaluate(
    createAiProvider({ nodeEnv: 'test', provider: 'fake' }),
    cases,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    cases.map((sample) => sample.id),
  );
  for (const row of rows) {
    assert.ok(row.modelOutput && row.draft, row.id);
    const follow = row.draft.followUp;
    if (follow) assert.ok(row.text.includes(follow.evidence), row.id);
  }
  assert.deepEqual(rows.find((row) => row.id === 'next-week')?.failures, []);
});

void test('holdout reports identify the set and choose review samples independent of development IDs', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: 'new-' + i,
    category: '新样本',
    text: '原话 ' + i,
    expected: {},
    modelOutput: null,
    draft: { note: '纪要 ' + i },
    failures: [],
  }));
  const report = renderReport('offline', rows, undefined, 'holdout');
  assert.match(report, /留出集/);
  for (const i of [0, 4, 8, 12, 16]) assert.ok(report.includes('纪要 ' + i));
});
