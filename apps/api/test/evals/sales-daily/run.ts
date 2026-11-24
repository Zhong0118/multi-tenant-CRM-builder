import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runDataset } from '../run-dataset';
import { loadCases } from './cases';
import { FakeAiProvider } from '../../../src/modules/ai/providers/fake-ai.provider';
import { VercelOpenAiProvider } from '../../../src/modules/ai/providers/vercel-openai.provider';
import type { AiProvider } from '../../../src/modules/ai/ai-provider';
import type { TenantContext } from '../../../src/common/tenancy/tenant-context';
import {
  briefSystem,
  suggestionSchema,
  validateSuggestions,
} from '../../../src/modules/ai/daily-brief/brief-suggestions';
import {
  writingSystem,
  reportSystem,
  writingSchema,
  reportSchema,
  validateReport,
  validateWriting,
  sections,
} from '../../../src/modules/ai/sales-draft-output';
import type { Usage } from '../../../src/modules/ai/governance/model-meter';
import type { z } from 'zod';

async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string', default: 'development' },
      feature: { type: 'string' },
      sample: { type: 'string' },
      report: { type: 'string' },
      real: { type: 'boolean', default: false },
    },
  });
  const name = values.dataset,
    feature = values.feature;
  if (
    (name !== 'development' && name !== 'holdout') ||
    (feature !== 'daily_brief' &&
      feature !== 'writing' &&
      feature !== 'daily_report')
  )
    throw Error('Specify dataset and feature');
  const samples = await loadCases(name);
  let usage: Usage = {};
  if (
    values.real &&
    (!process.env.AI_API_KEY ||
      !process.env.AI_MODEL ||
      process.env.AI_BASE_URL !== 'https://api.deepseek.com')
  )
    throw Error('Set the official DeepSeek endpoint, model and key');
  const provider: AiProvider = values.real
    ? new VercelOpenAiProvider({
        apiKey: process.env.AI_API_KEY!,
        modelKey: process.env.AI_MODEL!,
        baseURL: process.env.AI_BASE_URL,
        protocol: 'responses',
        onUsage: (u) => {
          usage = u;
        },
      })
    : new FakeAiProvider();
  const actor = {} as TenantContext; // Synthetic inputs at the provider boundary. Row and field ACLs have separate DB/HTTP tests.
  const call = (payload: unknown, system: string, schema: z.ZodType) =>
    provider.generateSalesDaily!({
      actor,
      feature,
      system,
      schema,
      prompt: JSON.stringify(payload),
    });
  let diagnostic: string | undefined;
  const indices = Array.from(
    { length: samples[feature].length },
    (_, i) => i,
  ).filter((i) => !values.sample || String(i + 1) === values.sample);
  if (!indices.length) throw Error('Unknown sample');
  const date = '2026-11-24';
  const rows = await runDataset(
    indices,
    async (i) => {
      usage = {};
      diagnostic = undefined;
      try {
        if (feature === 'daily_brief') {
          const candidates = samples.daily_brief[i];
          const raw = await call(
            {
              localDate: date,
              records: candidates.map(
                ({ recordRef, title, objectName, facts }) => ({
                  recordRef,
                  title,
                  objectName,
                  facts,
                }),
              ),
            },
            briefSystem,
            suggestionSchema,
          );
          const output = validateSuggestions(raw, candidates, date);
          const expected = suggestionSchema.parse(raw).items;
          const valid =
            output.length >= 3 &&
            output.length <= 5 &&
            output.length === expected.length;
          return { output, raw, valid, usage };
        }
        if (feature === 'writing') {
          const { options, facts, title } = samples.writing[i];
          const raw = await call(
            { options, facts, truncated: false, timeZone: 'Asia/Shanghai' },
            writingSystem,
            writingSchema,
          );
          const output = validateWriting(raw, options, facts);
          const source = writingSchema.parse(raw);
          const sentences = source.blocks
            .flatMap((b) => b.text.match(/[^。！？!?\n]+[。！？!?]?/gu) ?? [])
            .map((s) => s.trim())
            .filter(Boolean);
          const joined = output.blocks.map((b) => b.text).join('\n');
          const altered = sentences.filter((s) => !joined.includes(s)).length;
          return {
            output,
            raw,
            valid: joined.length > 0 && output.kind === options.kind,
            usage,
            sentences: sentences.length,
            altered,
            titleIncluded: joined.includes(title),
          };
        }
        const facts = samples.daily_report[i],
          raw = await call(
            { workDate: date, facts, truncated: false },
            reportSystem,
            reportSchema,
          );
        const output = validateReport(raw, facts),
          covered = facts.filter((f) =>
            output[f.section!].includes(f.text),
          ).length;
        const valid = sections.every((k) =>
          output[k]
            .split('\n')
            .filter(Boolean)
            .every((s) => facts.some((f) => f.section === k && f.text === s)),
        );
        return {
          raw,
          output,
          usage,
          valid: valid && covered === facts.length,
          covered,
          available: facts.length,
        };
      } catch (error) {
        const e = error as {
          name?: string;
          message?: string;
          statusCode?: number;
          finishReason?: string;
          cause?: { name?: string };
        };
        const known = [
          'AI_NoObjectGeneratedError',
          'AI_APICallError',
          'AI_TypeValidationError',
          'AI_JSONParseError',
          'TimeoutError',
          'ZodError',
        ];
        diagnostic = [
          e?.message === 'INCOMPLETE_OUTPUT'
            ? 'INCOMPLETE_OUTPUT'
            : (known.find((name) => name === e?.name) ?? 'OTHER'),
          Number.isInteger(e?.statusCode) ? e.statusCode : null,
          known.find((name) => name === e?.cause?.name),
          ['length', 'stop', 'error', 'content-filter'].find(
            (reason) => reason === e?.finishReason,
          ),
        ]
          .filter(Boolean)
          .join('/');
        throw error;
      }
    },
    (_, draft) => (draft.valid ? [] : ['OUTPUT_MISMATCH']),
    () => diagnostic,
  );
  const passed = rows.filter((r) => !r.failures.length).length;
  const retained = rows.map(({ sample, draft, failures, modelOutput }) => ({
    diagnostic: modelOutput,
    sample: sample + 1,
    draft,
    failures,
  }));
  const report = {
    date,
    feature,
    dataset: name,
    model: provider.modelKey,
    passed,
    total: rows.length,
    rows: retained,
  };
  if (values.report)
    await writeFile(values.report, JSON.stringify(report, null, 2));
  console.log(feature, name, passed + '/' + rows.length);
}
void main().catch(() => {
  console.error('Evaluation setup or persistence failed');
  process.exitCode = 1;
});
