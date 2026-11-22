import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
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

void test('the configured SDK uses the structured Responses API and the evaluator scores the server-validated draft', async () => {
  const sample = cases.find((c) => c.id === 'next-week')!;
  const raw = {
    note: '预算待批，下周联系。',
    followUp: {
      title: '回访',
      suggestedDate: '2099-01-01',
      evidence: '下周再联系',
    },
    fieldChanges: [],
  };
  let requestBody = '';
  let path = '';
  const server = createServer((req, res) => {
    path = req.url ?? '';
    req.on('data', (chunk: Buffer) => {
      requestBody += chunk.toString();
    });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
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
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const provider = createAiProvider({
      nodeEnv: 'development',
      provider: 'openai',
      apiKey: randomUUID(),
      model: 'transport-fixture',
      baseURL: 'http://127.0.0.1:' + address.port + '/v1',
    });
    const [row] = await evaluate(provider, [sample]);
    assert.equal(path, '/v1/responses');
    assert.match(requestBody, /json_schema/);
    assert.ok(requestBody.includes(sample.text));
    assert.deepEqual(row.failures, []);
    assert.deepEqual(row.modelOutput, raw);
    assert.equal(row.draft?.followUp?.suggestedDate, sample.expected.date);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
