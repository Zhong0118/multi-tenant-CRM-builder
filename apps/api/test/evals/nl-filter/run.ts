import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mock } from 'node:test';
import { parseArgs } from 'node:util';
import { Test } from '@nestjs/testing';
import type { FilterPreview } from '@crm/contracts';
import {
  AI_PROVIDER,
  createAiProvider,
  type AiProvider,
} from '../../../src/modules/ai/ai-provider';
import { FilterPreviewService } from '../../../src/modules/ai/filter-preview.service';
import type { FilterProviderInput } from '../../../src/modules/ai/filter-generation';
import { MembershipsService } from '../../../src/modules/memberships/memberships.service';
import { PublishedObjectService } from '../../../src/modules/objects/published-object.service';
import { RECORDS_REPOSITORY } from '../../../src/modules/records/records.service';
import { runDataset } from '../run-dataset';
import { actor, objects, store, now, outOfScopeMember } from './fixture';
import { score, type Sample } from './score';

type Generate = NonNullable<AiProvider['generateFilter']>;
type Trace = {
  called: boolean;
  fault: boolean;
  output: unknown;
  violations: string[];
};

function contextViolations(input: FilterProviderInput) {
  // Free-form user text may name a hidden field. Only the supplied metadata is privileged.
  const context = JSON.stringify({ ...input, text: undefined });
  return [
    ...(context.includes('secretMargin') || context.includes('内部毛利')
      ? ['权限：隐藏字段进入模型元数据']
      : []),
    ...(context.includes('shelved') || context.includes('已搁置')
      ? ['权限：停用选项进入模型元数据']
      : []),
    ...(context.includes(outOfScopeMember)
      ? ['权限：不可选成员进入模型元数据']
      : []),
    ...(input.followUpAssignees.includes('any')
      ? ['权限：员工可选全团队']
      : []),
    ...(input.today !== '2026-11-23'
      ? ['评测出错：模型看到的本地日期与固定时钟不符']
      : []),
  ];
}
function newTrace(): Trace {
  return { called: false, fault: false, output: null, violations: [] };
}

export async function evaluate(generate: Generate, samples: Sample[]) {
  let trace = newTrace();
  const module = await Test.createTestingModule({
    providers: [
      FilterPreviewService,
      { provide: PublishedObjectService, useValue: objects },
      { provide: MembershipsService, useValue: {} },
      {
        provide: RECORDS_REPOSITORY,
        useValue: {
          withTenant: (
            _actor: unknown,
            read: (fixture: typeof store) => unknown,
          ) => read(store),
        },
      },
      {
        provide: AI_PROVIDER,
        useValue: {
          generateFilter: async (
            input: FilterProviderInput,
            signal: AbortSignal,
          ) => {
            const current = trace;
            current.called = true;
            current.violations = contextViolations(input);
            try {
              current.output = await generate(input, signal);
              return current.output;
            } catch (error) {
              current.fault = true;
              throw error;
            }
          },
        },
      },
    ],
  }).compile();
  const service = module.get(FilterPreviewService);
  mock.timers.enable({ apis: ['Date'], now });
  try {
    const rows = await runDataset(
      samples,
      async ({ text, currentRule }) => {
        trace = newTrace();
        return service.preview(actor, 'customers', { text, currentRule });
      },
      (sample, preview: FilterPreview) => {
        const failures = score(sample, preview);
        if (JSON.stringify(preview).match(/secretMargin|内部毛利/))
          failures.push('权限：响应泄露隐藏字段');
        if (
          preview.kind === 'unavailable' &&
          JSON.stringify(preview) !== '{"kind":"unavailable"}'
        )
          failures.push('权限：拒绝响应携带额外数据');
        return failures;
      },
      () => trace,
    );
    return rows.map((row) => {
      const audit = row.modelOutput as Trace;
      const failures = [...row.failures, ...audit.violations];
      if (audit.fault) failures.push('模型调用故障');
      if (!audit.called) failures.push('评测出错：未调用模型');
      return { ...row, failures, audit };
    });
  } finally {
    mock.timers.reset();
    await module.close();
  }
}

const emptyRule = { version: 1, match: 'all', conditions: [] } as const;
export async function securityChecks() {
  const owner = { fieldKey: '$owner', operator: 'in', value: ['$me'] };
  const hidden = { fieldKey: 'secretMargin', operator: 'gt', value: '0' };
  const rule = (...conditions: unknown[]) => ({ ...emptyRule, conditions });
  const probes: [string, unknown][] = [
    ['附加隐藏字段', { rules: [rule(owner, hidden)] }],
    ['候选之一带隐藏字段', { rules: [rule(owner), rule(hidden)] }],
    [
      '未知字段',
      {
        rules: [
          rule({
            fieldKey: 'neverPublished',
            operator: 'notEmpty',
            value: null,
          }),
        ],
      },
    ],
    [
      '停用阶段与活动阶段同选',
      {
        rules: [
          rule({
            fieldKey: 'stage',
            operator: 'in',
            value: ['quote', 'shelved'],
          }),
        ],
      },
    ],
    [
      '越权成员',
      {
        rules: [
          rule({
            fieldKey: '$owner',
            operator: 'in',
            value: [outOfScopeMember],
          }),
        ],
      },
    ],
    [
      '全团队待跟进',
      {
        rules: [
          rule({
            fieldKey: '$followUp',
            operator: 'dueThroughToday',
            value: { assignee: 'any' },
          }),
        ],
      },
    ],
  ];
  const rows = [];
  for (const [id, output] of probes) {
    const [row] = await evaluate(
      () => Promise.resolve(output),
      [
        {
          id,
          category: '权限探针',
          text: '筛出我负责的客户',
          currentRule: { ...emptyRule, conditions: [] },
          expected: { kind: 'unavailable' },
        },
      ],
    );
    rows.push(row);
  }
  return rows;
}

export async function readDataset(
  name: 'development' | 'holdout',
): Promise<Sample[]> {
  return JSON.parse(
    await readFile(join(__dirname, name + '.json'), 'utf8'),
  ) as Sample[];
}
type Row = Awaited<ReturnType<typeof evaluate>>[number];
function section(title: string, rows: Row[]) {
  const passed = rows.filter((r) => !r.failures.length);
  const lines = ['## ' + title, '', '| 主题 | 通过 / 总数 |', '| --- | ---: |'];
  for (const category of new Set(rows.map((r) => r.sample.category))) {
    lines.push(
      `| ${category} | ${passed.filter((r) => r.sample.category === category).length} / ${rows.filter((r) => r.sample.category === category).length} |`,
    );
  }
  lines.push(`| 合计 | ${passed.length} / ${rows.length} |`, '');
  const abstained = rows.filter(
    (r) =>
      r.draft?.kind === 'unavailable' &&
      !r.audit.fault &&
      JSON.stringify(r.audit.output) === '{"rules":[]}',
  ).length;
  const faults = rows.filter((r) => r.audit.fault || !r.draft).length;
  const blocked =
    rows.filter(
      (r) =>
        r.draft?.kind === 'unavailable' && r.audit.called && !r.audit.fault,
    ).length - abstained;
  lines.push(
    `模型主动弃答 ${abstained} 条，服务端拦截输出 ${blocked} 条，调用或执行故障 ${faults} 条。`,
    '',
  );
  for (const { sample, failures } of rows.filter((r) => r.failures.length)) {
    lines.push(`- ${sample.id}（${sample.category}） ${failures.join('，')}。`);
  }
  return lines.join('\n');
}
export function blocksDelivery(row: Row) {
  return Boolean(
    row.failures.length &&
    (row.sample.category === '权限探针' ||
      /隐藏|越权|权限|停用|restricted|missing/i.test(row.sample.category) ||
      row.failures.some(
        (f) =>
          f === 'EVAL_RUN_ERROR' ||
          f.startsWith('权限：') ||
          f.startsWith('评测出错：'),
      ) ||
      row.audit.fault ||
      !row.draft),
  );
}
async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string', default: 'both' },
      report: { type: 'string' },
      strict: { type: 'boolean' },
    },
  });
  const dataset = values.dataset;
  if (dataset !== 'both' && dataset !== 'development' && dataset !== 'holdout')
    throw new Error('--dataset 仅接受 development、holdout 或 both');
  const mode = process.env.NL_FILTER_EVAL_PROVIDER ?? 'fake';
  if (!['real', 'fake'].includes(mode))
    throw new Error('NL_FILTER_EVAL_PROVIDER 仅接受 fake 或 real');
  if (
    mode === 'real' &&
    (!process.env.AI_MODEL?.trim() || !process.env.AI_API_KEY?.trim())
  )
    throw new Error('真实评测需要设置 AI_MODEL 和 AI_API_KEY');
  const provider = createAiProvider(
    mode === 'fake'
      ? { nodeEnv: 'test', provider: 'fake' }
      : { nodeEnv: 'development', provider: 'openai' },
  );
  if (!provider.generateFilter) throw new Error('Provider 没有筛选生成方法');
  const generate = provider.generateFilter.bind(provider);
  const dev =
    dataset === 'holdout'
      ? []
      : await evaluate(generate, await readDataset('development'));
  const holdout =
    dataset === 'development'
      ? []
      : await evaluate(generate, await readDataset('holdout'));
  const probes = await securityChecks();
  const report =
    [
      '# 自然语言筛选评测',
      '',
      `Provider / 模型为 ${provider.providerKey} / ${provider.modelKey}。`,
      mode === 'fake'
        ? '模拟 provider 的分数仅衡量脚本覆盖的示例。真实模型语言理解能力未在此次运行中评估。'
        : '使用同一模型与固定上下文分别运行两组语料。',
      '',
      '样本角色为普通员工，租户时区为 Asia/Shanghai，时钟固定在 2026-11-22 16:00 UTC（当地次日零点）。留出集冻结于 3021158。',
      '',
      ...(dev.length ? [section('开发集', dev), ''] : []),
      ...(holdout.length ? [section('冻结留出集', holdout), ''] : []),
      section('独立注入无效模型输出的权限检查', probes),
      '',
      '## 复现',
      '',
      '在仓库根目录执行。默认运行模拟 provider，同时执行独立权限检查。任一安全用例失败或模型调用故障，进程返回非零退出码。开发时可用 `--dataset development` 单独运行开发集。使用 `--strict` 可要求所选语料全部通过。',
      '',
      '```sh',
      'pnpm --filter @crm/contracts --filter @crm/database build',
      'pnpm --filter @crm/api eval:nl-filter:test',
      'pnpm --filter @crm/api eval:nl-filter',
      '```',
      '',
      '真实模型使用本机配置的 AI_MODEL 和 AI_API_KEY。兼容服务可通过 AI_BASE_URL 指定端点。',
      '',
      '```sh',
      'NL_FILTER_EVAL_PROVIDER=real pnpm --filter @crm/api eval:nl-filter --report /tmp/nl-filter-real.md',
      '```',
    ].join('\n') + '\n';
  if (values.report) await writeFile(values.report, report);
  else process.stdout.write(report);
  const rows = [...dev, ...holdout, ...probes];
  if (
    rows.some(blocksDelivery) ||
    (values.strict && rows.some((r) => r.failures.length))
  )
    process.exitCode = 1;
}
if (require.main === module)
  void main().catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : '';
    console.error(
      msg.startsWith('--dataset') ||
        msg.startsWith('NL_FILTER_EVAL_PROVIDER') ||
        msg.startsWith('真实评测需要') ||
        msg.startsWith('Provider 没有')
        ? msg
        : '评测未完成，请检查提供方、样本和报告路径。',
    );
    process.exitCode = 1;
  });
