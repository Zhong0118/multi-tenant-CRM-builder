import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { assertIsolatedTestDatabase } from '../../helpers/isolated-database';
import { exitCode, type EvalCase, type Observation } from './score';
import { createAiProvider } from '../../../src/modules/ai/ai-provider';

type Result = {
  sample: EvalCase;
  draft: Observation[] | null;
  failures: string[];
};
function report(dataset: string, model: string, rows: Result[]) {
  const passed = rows.filter((row) => !row.failures.length);
  const lines = [
    `# 对话助手评测 · ${dataset}`,
    '',
    `模型为 ${model}。整条对话通过 ${passed.length}/${rows.length}。`,
    '',
    '评测通过真实编排、业务读取、问题续答和提议持久化。每一步检查实际读到的候选、跨租户标记、隐藏数据和确认前的业务状态。',
    '',
    '| 首步意图 | 通过 / 总数 |',
    '| --- | --- |',
  ];
  for (const kind of new Set(rows.map((r) => r.sample.steps[0].expect.kind))) {
    const group = rows.filter((r) => r.sample.steps[0].expect.kind === kind);
    lines.push(
      `| ${kind} | ${group.filter((r) => !r.failures.length).length}/${group.length} |`,
    );
  }
  lines.push('', '## 样本结果', '');
  for (const { sample, draft, failures } of rows) {
    lines.push(
      `### ${sample.id}`,
      '',
      sample.steps[0].say ?? '',
      '',
      failures.length ? failures.join(' · ') : '通过',
      '',
    );
    for (const step of draft ?? []) {
      lines.push(
        `- 输出 ${step.kind}。工具 ${step.tools.join('、') || '无'}。`,
      );
      if (step.prompt) lines.push('', '> ' + step.prompt, '');
      if (step.failure) lines.push('', '> ' + step.failure, '');
      if (step.preview) lines.push('', '筛选预览 ' + step.preview, '');
      if (step.searchTotal !== undefined)
        lines.push('', '查询实际匹配 ' + step.searchTotal + ' 条。', '');
      if (step.content)
        lines.push(
          '',
          ...step.content.split('\n').map((line) => (line ? '> ' + line : '>')),
          '',
        );
      if (step.choices || step.fields)
        lines.push('', (step.choices ?? step.fields ?? []).join('、'), '');
      if (step.operations.length)
        lines.push(
          '',
          '    ' +
            JSON.stringify({
              targets: step.targets,
              operations: step.operations,
            }),
          '',
        );
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string', default: 'development' },
      report: { type: 'string' },
      strict: { type: 'boolean' },
    },
  });
  const dataset = values.dataset;
  if (dataset !== 'development' && dataset !== 'holdout')
    throw new Error('invalid dataset');
  assertIsolatedTestDatabase(
    process.env.TEST_DATABASE_URL,
    process.env.TEST_DATABASE_ADMIN_URL,
  );
  const mode = process.env.ASSISTANT_EVAL_PROVIDER ?? 'fake';
  if (!['fake', 'real'].includes(mode)) throw new Error('invalid provider');
  if (
    mode === 'real' &&
    (!process.env.AI_API_KEY?.trim() ||
      !process.env.AI_MODEL?.trim() ||
      (process.env.CI && !['0', 'false'].includes(process.env.CI)))
  )
    throw new Error(
      'real model requires local opt-in, AI_MODEL and AI_API_KEY',
    );
  const provider =
    mode === 'real'
      ? createAiProvider({
          nodeEnv: 'development',
          provider: 'openai',
          apiKey: process.env.AI_API_KEY,
          model: process.env.AI_MODEL,
          baseURL: process.env.AI_BASE_URL,
        })
      : createAiProvider({ nodeEnv: 'test', provider: 'fake' });
  process.env.NODE_ENV = 'test';
  process.env.DEV_VERIFICATION_CODE = '123456';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.WEB_ORIGIN = 'http://localhost:3000';
  const { evaluate } = createRequire(__filename)(
    './evaluate',
  ) as typeof import('./evaluate');
  const cases = JSON.parse(
    await readFile(join(__dirname, dataset + '.json'), 'utf8'),
  ) as EvalCase[];
  if (!cases.length || new Set(cases.map((s) => s.id)).size !== cases.length)
    throw new Error('invalid dataset');
  const rows = await evaluate(provider, cases);
  let output = report(
    dataset,
    provider.providerKey + ' / ' + (provider.modelKey ?? '未指定'),
    rows,
  );
  if (process.env.AI_API_KEY)
    output = output.replaceAll(process.env.AI_API_KEY, '[已隐藏]');
  if (values.report) await writeFile(values.report, output, { mode: 0o600 });
  else process.stdout.write(output + '\n');
  console.log(
    `${dataset} · ${rows.filter((r) => !r.failures.length).length}/${rows.length}`,
  );
  process.exitCode = exitCode(rows, values.strict);
}
void main().catch((error) => {
  const known = [
    'invalid dataset',
    'invalid provider',
    'real model requires local opt-in, AI_MODEL and AI_API_KEY',
    'TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required',
    'Refusing non-isolated local test database',
    'Test database URLs must use the same host, port and database',
    'Refusing unexpected database roles',
  ];
  const message =
    error instanceof Error && known.includes(error.message)
      ? error.message
      : '请检查独立测试库、迁移、数据集和模型配置。';
  console.error('评测未完成。' + message);
  process.exitCode = 1;
});
