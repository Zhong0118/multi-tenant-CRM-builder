import { estimateRequestInput, outputLimit, ModelMeter } from './model-meter';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { AiLedgerService } from './ai-ledger.service';
import { InMemoryRateLimiter } from '../../../infrastructure/rate-limit/rate-limiter';

const actor = { tenantId: 'company', memberId: 'employee' } as TenantContext;
function fixture() {
  const ledger = {
    reserve: jest.fn(),
    settle: jest.fn(),
    recordDenial: jest.fn(),
  };
  const meter = new ModelMeter(
    ledger as unknown as AiLedgerService,
    new InMemoryRateLimiter(),
    actor,
    'filter',
    'openai-compatible',
    'model',
  );
  return { ledger, meter };
}
describe('model request metering', () => {
  it('counts the serialized UTF-8 body and provider input messages without counting credentials', () => {
    const body = JSON.stringify({
      instructions: '根据权限筛选',
      input: [
        { role: 'user', content: 'A😄' },
        { type: 'function_call_output', output: '可见' },
      ],
      tools: [{ description: '完整的说明' }],
    });
    expect(estimateRequestInput(body)).toBe(Buffer.byteLength(body) + 48);
  });
  it('rejects without sending and never shrinks the output budget', async () => {
    const { ledger, meter } = fixture();
    ledger.reserve.mockRejectedValueOnce(new Error('budget exhausted'));
    await expect(
      meter.begin('{"input":"hi"}', new AbortController().signal),
    ).rejects.toThrow('budget exhausted');
    expect(ledger.reserve.mock.calls[0][1].outputTokens).toBe(
      outputLimit.filter,
    );
    expect(ledger.settle).not.toHaveBeenCalled();
  });
  it('records partial usage on cancellation, once per call', async () => {
    const { ledger, meter } = fixture();
    await meter.begin('{"input":"hi"}', new AbortController().signal);
    await meter.finish('cancelled', { inputTokens: 23 });
    await meter.finish('success', { inputTokens: 23, outputTokens: 4 });
    expect(ledger.settle).toHaveBeenCalledTimes(1);
    expect(ledger.settle.mock.calls[0][1]).toMatchObject({
      status: 'cancelled',
      inputTokens: 23,
    });
  });
});

it('rejects a second long call and releases only its own reservation', async () => {
  const ledger = {
    reserve: jest.fn(),
    settle: jest.fn(),
    recordDenial: jest.fn(),
  };
  const limiter = new InMemoryRateLimiter();
  const make = () =>
    new ModelMeter(ledger, limiter, actor, 'communication', 'test', 'fake');
  const first = make(),
    second = make(),
    signal = new AbortController().signal;
  await first.begin('{"input":"test"}', signal);
  await expect(second.begin('{"input":"test"}', signal)).rejects.toMatchObject({
    code: 'RATE_LIMITED',
  });
  expect(ledger.settle).toHaveBeenCalledWith(
    actor,
    expect.objectContaining({
      callId: ledger.reserve.mock.calls[1][1].callId,
      status: 'unsent',
    }),
  );
  await first.finish('success', { inputTokens: 8, outputTokens: 12 });
  await make().begin('{"input":"test"}', signal);
});

it('reserves with the original allocation and price, before sending', async () => {
  const ledger = {
    reserve: jest.fn(),
    settle: jest.fn(),
    recordDenial: jest.fn(),
  };
  const snapshot = {
    configSource: 'platform' as const,
    purpose: 'text' as const,
    providerId: 'p',
    revisionId: 'r',
    assignmentVersion: 4,
    inputPrice: '2.50',
    outputPrice: '4.00',
    currency: 'CNY',
  };
  const meter = new ModelMeter(
    ledger,
    new InMemoryRateLimiter(),
    actor,
    'filter',
    'custom',
    'test',
    snapshot,
    10000,
  );
  await meter.begin('{"input":"hi"}', new AbortController().signal);
  expect(ledger.reserve).toHaveBeenCalledWith(
    actor,
    expect.objectContaining({ snapshot }),
  );
  const limited = new ModelMeter(
    ledger,
    new InMemoryRateLimiter(),
    actor,
    'filter',
    'custom',
    'test',
    snapshot,
    3501,
  );
  await expect(
    limited.begin('{"input":"hi"}', new AbortController().signal),
  ).rejects.toMatchObject({ code: 'AI_MODEL_CONTEXT_EXCEEDED' });
  expect(ledger.reserve).toHaveBeenCalledTimes(1);
});

it('releases a failed physical HTTP attempt before the SDK retries', async () => {
  const { meter, ledger } = fixture();
  const network = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  try {
    const init = { method: 'POST', body: '{"input":"hi"}' };
    await meter.fetch('https://example.com/v1/responses', init);
    await meter.fetch('https://example.com/v1/responses', init);
    await meter.finish('success', { inputTokens: 2, outputTokens: 1 });
    expect(ledger.reserve).toHaveBeenCalledTimes(2);
    expect(ledger.settle).toHaveBeenNthCalledWith(
      1,
      actor,
      expect.objectContaining({ status: 'failed' }),
    );
    expect(ledger.settle).toHaveBeenNthCalledWith(
      2,
      actor,
      expect.objectContaining({ status: 'success' }),
    );
  } finally {
    network.mockRestore();
  }
});
