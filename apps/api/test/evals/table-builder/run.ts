import type { AiLedgerService } from '../../../src/modules/ai/governance/ai-ledger.service';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import type { TableBlueprint, TableBuilderResult } from '@crm/contracts';
import { ApiException } from '../../../src/common/errors/api.exception';
import type { TenantContext } from '../../../src/common/tenancy/tenant-context';
import {
  createAiProvider,
  type AiProvider,
} from '../../../src/modules/ai/ai-provider';
import { generateTablePlan } from '../../../src/modules/ai/table-generation';
import {
  TableBuilderService,
  builderBodies,
} from '../../../src/modules/ai/table-builder.service';
import { validateBlueprint } from '../../../src/modules/ai/table-blueprint';
import { TABLE_BUILDER_GENERATION_TIMEOUT_MS } from '../../../src/modules/ai/table-builder-payload';
import { tableModelSchema } from '../../../src/modules/ai/table-model';
import type { ObjectDraftBatchService } from '../../../src/modules/objects/object-draft-batch.service';
import { runDataset } from '../run-dataset';
import {
  measure,
  previewViolations,
  scoreTablePlan,
  type Sample,
} from './score';

type Generate = NonNullable<AiProvider['generateTableBlueprint']>;
type Dataset = 'development' | 'holdout';

const admin: TenantContext = {
  tenantId: 'eval',
  tenantCode: 'eval',
  userId: 'eval-admin',
  memberId: 'eval-admin',
  role: 'TENANT_ADMIN',
};
function newTrace() {
  return {
    called: false,
    generationMs: 0,
    providerFault: false,
    raw: null as unknown,
    rejection: null as null | {
      code: string;
      paths: string[];
      reason?: string;
    },
    eligible: false,
    admitted: false,
    violations: [] as string[],
  };
}
function adapter(generate: Generate): AiProvider {
  return {
    providerKey: 'eval',
    modelKey: null,
    generateTableBlueprint: generate,
    streamTurn() {
      throw new Error('Unexpected stream call');
    },
  };
}
export async function evaluate(generate: Generate, samples: Sample[]) {
  let trace = newTrace();
  const captured = adapter(async (input, signal) => {
    trace.called = true;
    const started = performance.now();
    try {
      const raw = await generate(input, signal);
      const checked = tableModelSchema.safeParse(raw);
      trace.raw = checked.success
        ? checked.data
        : {
            invalidOutput: true,
            paths: checked.error.issues.map((i) => i.path.join('.')),
          };
      return raw;
    } catch (error) {
      trace.providerFault = true;
      throw error;
    } finally {
      trace.generationMs += Math.round(performance.now() - started);
    }
  });
  const rows = await runDataset(
    samples,
    async (sample) => {
      trace = newTrace();
      const existing = sample.existingObjects.map((name, i) => ({
        name,
        id: 'existing-' + i,
        code: 'existing-' + i,
        fields: [],
      }));
      try {
        const candidate = await generateTablePlan(
          captured,
          {
            mode: 'create',
            description: sample.description,
            answers: sample.answers,
            existing,
          },
          AbortSignal.timeout(TABLE_BUILDER_GENERATION_TIMEOUT_MS),
        );
        if (candidate.kind === 'question') return candidate;
        const checked = validateBlueprint(candidate.blueprint, existing);
        const result: TableBuilderResult = {
          kind: 'blueprint',
          blueprint: checked.blueprint,
          issues: [...candidate.issues, ...checked.issues],
        };
        trace.violations = previewViolations(result);
        trace.eligible =
          !result.issues.some((i) => i.blocking) &&
          !!result.blueprint.tables.length;
        if (trace.eligible) {
          const submitted = builderBodies.confirm.parse({
            blueprint: result.blueprint,
          });
          const rechecked = validateBlueprint(submitted.blueprint, existing);
          trace.admitted =
            !rechecked.issues.some((i) => i.blocking) &&
            isDeepStrictEqual(rechecked.blueprint, result.blueprint);
          if (!trace.admitted)
            trace.violations.push('确认门禁复验失败或执行编码发生变化');
        }
        return result;
      } catch (error) {
        trace.rejection = {
          code: error instanceof ApiException ? error.code : 'EVAL_RUN_ERROR',
          paths:
            error instanceof ApiException ? Object.keys(error.fieldErrors) : [],
          ...(error instanceof ApiException ? { reason: error.message } : {}),
        };
        throw error;
      }
    },
    scoreTablePlan,
    () => trace,
  );
  return rows.map((row) => ({
    ...row,
    audit: row.modelOutput as ReturnType<typeof newTrace>,
  }));
}
type Row = Awaited<ReturnType<typeof evaluate>>[number];
export function blocksDelivery(row: Row) {
  const { audit } = row;
  return (
    !audit.called ||
    audit.providerFault ||
    (audit.eligible && !audit.admitted) ||
    audit.violations.length > 0 ||
    (!row.draft && audit.rejection?.code !== 'VALIDATION_FAILED')
  );
}

export async function forgedProbes() {
  let writes = 0;
  const service = new TableBuilderService(
    {
      confirmTableBlueprint() {
        writes++;
        return Promise.resolve({ objects: [] });
      },
    } as unknown as ObjectDraftBatchService,
    adapter(() => Promise.reject(new Error('Unexpected provider call'))),
    { assertFeature: () => Promise.resolve() } as unknown as AiLedgerService,
  );
  const id = '00000000-0000-4000-8000-000000000001',
    fieldId = '00000000-0000-4000-8000-000000000002';
  const plan = validateBlueprint(
    {
      version: 1,
      assumptions: [],
      omitted: [],
      tables: [
        {
          id,
          code: '',
          name: '示例',
          reason: '示例实体',
          fields: [
            {
              id: fieldId,
              fieldKey: '',
              label: '名称',
              required: true,
              type: 'TEXT',
              reason: '用于识别',
            },
          ],
          titleFieldId: fieldId,
          view: { columnIds: [fieldId], reason: '展示名称' },
          employeeIntent: [],
        },
      ],
    },
    [],
  ).blueprint;
  const attempts = [
    {
      id: '授予员工全部记录',
      alter: (b: TableBlueprint) =>
        Object.assign(b.tables[0], {
          employeeAccess: { canRead: true, readScope: 'ALL' },
        }),
    },
    {
      id: '授予字段编辑',
      alter: (b: TableBlueprint) =>
        Object.assign(b.tables[0].fields[0], { employeeAccess: 'EDIT' }),
    },
    {
      id: '授予删除',
      alter: (b: TableBlueprint) => Object.assign(b, { canDelete: true }),
    },
  ];
  const evidence = [];
  for (const probe of attempts) {
    const blueprint = structuredClone(plan);
    probe.alter(blueprint);
    const before = writes;
    let code = 'ACCEPTED';
    try {
      await service.confirm(admin, { blueprint }, { requestId: 'eval' });
    } catch (error) {
      code = error instanceof ApiException ? error.code : 'EVAL_RUN_ERROR';
    }
    evidence.push({
      id: probe.id,
      code,
      writeCalls: writes - before,
      passed: code === 'VALIDATION_FAILED' && writes === before,
    });
  }
  return evidence;
}
export async function readDataset(dataset: Dataset) {
  return JSON.parse(
    await readFile(join(__dirname, dataset + '.json'), 'utf8'),
  ) as Sample[];
}
function ratio(hits: number, total: number) {
  return (
    hits +
    ' / ' +
    total +
    (total ? ' (' + ((100 * hits) / total).toFixed(1) + '%)' : ' (N/A)')
  );
}
function section(dataset: Dataset, rows: Row[]) {
  const checks = rows.map((r) => measure(r.sample, r.draft).checks);
  const counts = (k: keyof (typeof checks)[number]) => {
    const list = checks.flatMap((c) => c[k]);
    return ratio(list.filter(Boolean).length, list.length);
  };
  const eligible = rows.filter((r) => r.audit.eligible);
  const questions = rows.filter((r) => r.draft?.kind === 'question');
  const abstain = rows.filter(
    (r) => r.draft?.kind === 'blueprint' && !r.draft.blueprint.tables.length,
  );
  const blocked = rows.filter(
    (r) =>
      !r.audit.providerFault &&
      ((!r.draft && r.audit.rejection?.code === 'VALIDATION_FAILED') ||
        (r.draft?.kind === 'blueprint' &&
          r.draft.blueprint.tables.length > 0 &&
          r.draft.issues.some((i) => i.blocking))),
  );
  const lines = [
    '## ' + (dataset === 'development' ? '开发集' : '冻结留出集'),
    '',
    '| 指标 | 结果 |',
    '| --- | ---: |',
    '| 整条样本通过 | ' +
      ratio(
        rows.filter((r) => !r.failures.length && !blocksDelivery(r)).length,
        rows.length,
      ) +
      ' |',
    '| 可确认方案通过确认格式及业务复验 | ' +
      ratio(eligible.filter((r) => r.audit.admitted).length, eligible.length) +
      ' |',
    '| 预期实体命中 | ' + counts('entities') + ' |',
    '| 字段语义与类型同时命中 | ' + counts('types') + ' |',
    '| 明确要求的选项命中 | ' + counts('options') + ' |',
    '| 未采纳项已移除并说明 | ' + counts('omissions') + ' |',
    '| 追问（符合预期 / 实际） | ' +
      questions.filter((r) => r.sample.expectQuestion).length +
      ' / ' +
      questions.length +
      ' |',
    '| 空方案弃答 / 服务端拦截 / 调用或执行故障 | ' +
      [
        abstain.length,
        blocked.length,
        rows.filter(
          (r) =>
            r.audit.providerFault ||
            r.audit.rejection?.code === 'EVAL_RUN_ERROR',
        ).length,
      ].join(' / ') +
      ' |',
    '| 内置重复、可执行权限或复验违规 | ' +
      rows.reduce((total, r) => total + r.audit.violations.length, 0) +
      ' |',
    '',
    '| 行业 | 完整命中 / 样本 |',
    '| --- | ---: |',
  ];
  for (const industry of new Set(rows.map((r) => r.sample.industry))) {
    const industryRows = rows.filter((r) => r.sample.industry === industry);
    lines.push(
      '| ' +
        industry +
        ' | ' +
        ratio(
          industryRows.filter((r) => !r.failures.length && !blocksDelivery(r))
            .length,
          industryRows.length,
        ) +
        ' |',
    );
  }
  lines.push('', '| 样本 | 输出 | 缺失或阻塞 |', '| --- | --- | --- |');
  for (const r of rows) {
    const result = r.audit.admitted
      ? '可确认'
      : r.draft?.kind === 'question'
        ? '追问'
        : r.audit.providerFault
          ? '调用故障'
          : '已阻塞或弃答';
    lines.push(
      '| ' +
        r.sample.id +
        ' | ' +
        result +
        ' | ' +
        [...r.failures, ...r.audit.violations]
          .join('，')
          .replaceAll('|', '／') +
        ' |',
    );
  }
  lines.push(
    '',
    '模型调用耗时按实际返回的表数分组。0 表表示追问或空方案，未取得输出的请求单列。分位数使用最近秩。',
    '',
    '| 返回表数 | 样本数 | p50（秒） | p95（秒） |',
    '| --- | ---: | ---: | ---: |',
  );
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const raw = row.audit.raw as { tables?: unknown[] } | null;
    const key = Array.isArray(raw?.tables)
      ? String(raw.tables.length)
      : '无有效输出';
    const times = groups.get(key) ?? [];
    times.push(row.audit.generationMs);
    groups.set(key, times);
  }
  for (const [key, times] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b, 'en', { numeric: true }),
  )) {
    times.sort((a, b) => a - b);
    const seconds = (q: number) =>
      (times[Math.ceil(times.length * q) - 1] / 1000).toFixed(1);
    lines.push(
      `| ${key} | ${times.length} | ${seconds(0.5)} | ${seconds(0.95)} |`,
    );
  }
  return lines.join('\n');
}
async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string', default: 'both' },
      report: { type: 'string' },
      trace: { type: 'string' },
      strict: { type: 'boolean' },
    },
  });
  if (!['both', 'development', 'holdout'].includes(values.dataset))
    throw Error('未知样本集');
  const mode = process.env.TABLE_BUILDER_EVAL_PROVIDER ?? 'fake';
  if (!['fake', 'real'].includes(mode)) throw Error('未知提供方');
  if (
    mode === 'real' &&
    ((process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0') ||
      !process.env.AI_MODEL?.trim() ||
      !process.env.AI_API_KEY?.trim())
  )
    throw Error('真实评测需要本机显式模型配置');
  const provider = createAiProvider(
    mode === 'fake'
      ? {
          nodeEnv: 'test',
          provider: 'fake',
          model: 'fake',
          apiKey: '',
          baseURL: '',
        }
      : { nodeEnv: 'development', provider: 'openai' },
  );
  if (!provider.generateTableBlueprint) throw Error('生成提供方不可用');
  const generate = provider.generateTableBlueprint.bind(provider);
  const datasets: Dataset[] =
    values.dataset === 'both'
      ? ['development', 'holdout']
      : [values.dataset as Dataset];
  const sections = [],
    traces = [];
  let failed = false;
  for (const name of datasets) {
    const rows = await evaluate(generate, await readDataset(name));
    sections.push(section(name, rows));
    for (const row of rows) {
      if (blocksDelivery(row) || (values.strict && row.failures.length))
        failed = true;
      traces.push({
        dataset: name,
        sampleId: row.sample.id,
        generationMs: row.audit.generationMs,
        raw: row.audit.raw,
        rejection: row.audit.rejection,
        preview: row.draft,
        admitted: row.audit.admitted,
        failures: row.failures,
        violations: row.audit.violations,
      });
    }
  }
  const probes = await forgedProbes();
  failed ||= probes.some((p) => !p.passed);
  sections.push(
    '## 伪造确认请求\n\n| 请求 | 结果 | 进入写入方法次数 |\n| --- | --- | ---: |\n' +
      probes
        .map((p) => '| ' + p.id + ' | ' + p.code + ' | ' + p.writeCalls + ' |')
        .join('\n'),
  );
  const report =
    [
      '# AI 建表样本评测',
      '提供方 ' +
        provider.providerKey +
        '，模型 ' +
        provider.modelKey +
        '。留出输入冻结于 `f12a232`。评分口径 v2 要求 holdout-08 展示七张表并阻止直接确认。',
      '每个样本独立调用生产生成入口和业务校验器。可确认方案还须通过 confirm 的严格请求格式、当前元数据上的二次校验并保留所有执行键。本命令不连接数据库。伪造请求调用生产 confirm 服务，并计数进入持久化方法的次数。数据库写入和事务回滚另由 HTTP + PostgreSQL 测试验证。',
      '实体与字段以 NFKC、忽略大小写及多余空白后的字面包含匹配。预期词须出现在候选名称中。字段还须类型相同，选项标签须完全匹配。未命中的实体仍计入其所有预期字段和选项。遗漏说明须点名，并从表和字段中移除。未给选项的样本不计入选项分母。',
      mode === 'fake'
        ? '本次仅衡量模拟场景的覆盖情况，逐项追问计入未命中的明确需求。'
        : '本次通过本机配置的真实提供方执行。',
      ...sections,
    ].join('\n\n') + '\n';
  // Malformed model values never enter the audit file. Persist only selected
  // synthetic fixture outputs; errors include codes and paths, never stacks.
  const redact = (s: string) => {
    let safe = s.replace(/\b(?:sk-|Bearer\s+)[\w.-]{8,}/gi, '[redacted]');
    if (mode === 'real' && process.env.AI_API_KEY)
      safe = safe.replaceAll(process.env.AI_API_KEY, '[redacted]');
    return safe;
  };
  if (values.report)
    await writeFile(values.report, redact(report), { mode: 0o600 });
  else process.stdout.write(redact(report));
  if (values.trace)
    await writeFile(
      values.trace,
      redact(JSON.stringify(traces, null, 2) + '\n'),
      { mode: 0o600 },
    );
  if (failed) process.exitCode = 1;
}
if (require.main === module)
  void main().catch(() => {
    console.error('建表评测未完成，请检查样本参数、本机提供方配置或报告路径。');
    process.exitCode = 1;
  });
