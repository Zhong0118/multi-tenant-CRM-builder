// Explicit live smoke test with synthetic inputs. The report contains no prompts or completions.
import { z } from 'zod';
import { VercelOpenAiProvider } from '../../../src/modules/ai/providers/vercel-openai.provider';
import {
  ModelMeter,
  type GenerationFeature,
  type MeterLedger,
} from '../../../src/modules/ai/governance/model-meter';
import { InMemoryRateLimiter } from '../../../src/infrastructure/rate-limit/rate-limiter';
import type { TenantContext } from '../../../src/common/tenancy/tenant-context';
type Row = {
  sample: string;
  feature: GenerationFeature;
  estimate: number;
  bytes: number;
  messages: number;
  status: string;
  input?: number;
  output?: number;
};
const rows: Row[] = [];
const diagnostics: { sample: string; error: string }[] = [];
async function sample(language: 'zh' | 'en', feature: GenerationFeature) {
  const label = feature + '-' + language;
  const calls = new Map<string, Row>();
  const ledger: MeterLedger = {
    async reserve(_, r) {
      const row = {
        sample: label,
        feature,
        estimate: r.inputTokens,
        bytes: 0,
        messages: 0,
        status: 'pending',
      };
      calls.set(r.callId, row);
      rows.push(row);
    },
    async settle(_, s) {
      const row = calls.get(s.callId)!;
      Object.assign(row, {
        status: s.status,
        input: s.inputTokens,
        output: s.outputTokens,
      });
    },
    async recordDenial() {
      throw new Error('unexpected denial');
    },
  };
  const actor: TenantContext = {
    tenantId: 'synthetic',
    memberId: 'synthetic',
    tenantCode: 'test',
    userId: 'synthetic',
    role: 'TENANT_ADMIN',
  };
  const provider = new VercelOpenAiProvider({
    apiKey: process.env.AI_API_KEY!,
    modelKey: process.env.AI_MODEL || 'deepseek-flash',
    baseURL: 'https://api.deepseek.com/v1',
    meter: (_actor, f, p, m) => {
      const meter = new ModelMeter(
        ledger,
        new InMemoryRateLimiter(),
        actor,
        f,
        p,
        m,
      );
      const begin = meter.begin.bind(meter);
      meter.begin = async (body, signal) => {
        await begin(body, signal);
        const row = Array.from(calls.values()).at(-1)!;
        row.bytes = Buffer.byteLength(body);
        const wire = JSON.parse(body) as { messages: unknown[] };
        row.messages = wire.messages.length;
      };
      return meter;
    },
  });
  const signal = AbortSignal.timeout(90000),
    zh = language === 'zh';
  if (feature === 'assistant') {
    const events = provider.streamTurn({
      actor,
      messages: [
        {
          role: 'user',
          content: zh
            ? '请先调用 lookup 取数字，告诉我它是多少。'
            : 'Call lookup to retrieve a number and tell me its value.',
        },
      ],
      system: 'Use the lookup tool once then answer briefly.',
      tools: [
        {
          name: 'lookup',
          description: 'Read the example value',
          inputSchema: z.object({}),
          execute: async () => ({ value: 42 }),
        },
      ],
      abortSignal: signal,
    });
    for await (const e of events)
      if (e.type === 'FAILED') throw new Error('turn failed');
  } else if (feature === 'communication')
    await provider.generateCommunication(
      {
        text: zh
          ? '预算还未确认，下周再联系。'
          : 'Please follow up on Monday to confirm the budget.',
        now: '2026-11-24T09:00:00Z',
        timeZone: 'Asia/Shanghai',
        fields: [],
        recordContext: {},
      },
      signal,
      actor,
    );
  else if (feature === 'filter')
    await provider.generateFilter(
      {
        text: zh ? '金额大于 100' : 'amount above 100',
        currentRule: { version: 1, match: 'all', conditions: [] },
        fields: [
          {
            label: zh ? '金额' : 'Amount',
            fieldKey: 'amount',
            type: 'NUMBER',
            operators: ['gt'],
          },
        ],
        relativeDates: [],
        followUpAssignees: ['$me'],
        today: '2026-11-24',
      },
      signal,
      actor,
    );
  else
    await provider.generateTableBlueprint(
      {
        mode: 'create',
        description: zh
          ? '建一张设备表，只需要设备名称和型号。'
          : 'One equipment table with equipment name and model.',
        answers: [],
        existing: [],
        mayAsk: true,
      },
      signal,
      actor,
    );
}
async function main() {
  if (
    process.env.CI === 'true' ||
    !process.env.AI_API_KEY ||
    process.env.AI_GOVERNANCE_LIVE !== '1'
  )
    throw new Error('live opt-in and key required');
  for (const feature of [
    'assistant',
    'communication',
    'filter',
    'table_builder',
  ] as const)
    if (
      !process.env.AI_GOVERNANCE_SAMPLE ||
      process.env.AI_GOVERNANCE_SAMPLE === feature
    )
      await Promise.all(
        (['zh', 'en'] as const).map((lang) =>
          sample(lang, feature).catch((e: unknown) => {
            diagnostics.push({
              sample: feature + '-' + lang,
              error:
                e instanceof Error && /^[a-zA-Z_]{1,80}$/.test(e.name)
                  ? e.name
                  : 'generation failed',
            });
          }),
        ),
      );
  console.log(
    JSON.stringify(
      {
        model: process.env.AI_MODEL || 'deepseek-flash',
        calls: rows,
        diagnostics,
      },
      null,
      2,
    ),
  );
  if (
    !rows.length ||
    diagnostics.length ||
    rows.some((r) => r.input === undefined || r.output === undefined)
  )
    process.exitCode = 1;
}
void main().catch(() => {
  console.error('Live measurement unavailable');
  process.exitCode = 1;
});
