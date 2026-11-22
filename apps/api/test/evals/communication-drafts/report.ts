import type { AiProviderEnv } from '../../../src/modules/ai/ai-provider';
import type { CommunicationOutput } from '../../../src/modules/ai/communication-draft-generator';

export function providerSettings(env: NodeJS.ProcessEnv): AiProviderEnv {
  switch (env.COMMUNICATION_EVAL_PROVIDER ?? 'fake') {
    case 'fake':
      return { nodeEnv: 'test', provider: 'fake' };
    case 'real': {
      if (env.CI && !['0', 'false'].includes(env.CI))
        throw new Error('CI 仅允许运行模拟评测');
      const model = env.AI_MODEL?.trim();
      if (!model) throw new Error('请设置 AI_MODEL');
      if (!env.AI_API_KEY?.trim()) throw new Error('请在本机设置 AI_API_KEY');
      return {
        nodeEnv: 'development',
        provider: 'openai',
        model,
        apiKey: env.AI_API_KEY,
        baseURL: env.AI_BASE_URL,
      };
    }
    default:
      throw new Error('COMMUNICATION_EVAL_PROVIDER 仅接受 fake 或 real');
  }
}

export interface CaseResult {
  id: string;
  category: string;
  text: string;
  expected: unknown;
  modelOutput: unknown;
  draft: CommunicationOutput | null;
  failures: string[];
}

export function renderReport(
  model: string,
  rows: CaseResult[],
  secret?: string,
  dataset: 'development' | 'holdout' = 'development',
): string {
  const passed = rows.filter((row) => !row.failures.length);
  const lines = [
    '# 沟通草稿结构化评测 · ' + (dataset === 'holdout' ? '留出集' : '开发集'),
    '',
    'Provider / 模型为 ' +
      model +
      '。按整条样本计分，日期、跟进、字段和值及依据须全部符合预期。',
    '',
    '| 类别 | 通过 / 样本 | 通过率 |',
    '| --- | ---: | ---: |',
  ];
  for (const category of new Set(rows.map((row) => row.category))) {
    const total = rows.filter((row) => row.category === category).length;
    const ok = passed.filter((row) => row.category === category).length;
    lines.push(
      `| ${category} | ${ok}/${total} | ${Math.round((ok * 100) / total)}% |`,
    );
  }
  lines.push(
    `| **合计** | **${passed.length}/${rows.length}** | **${Math.round((100 * passed.length) / rows.length)}%** |`,
    '',
    '## 未通过的样本',
    '',
  );
  for (const row of rows.filter((r) => r.failures.length)) {
    lines.push('### ' + row.id, '', row.failures.join('；'), '');
    for (const [label, value] of [
      ['原话', row.text],
      ['预期', row.expected],
      ['模型输出', row.modelOutput],
      ['销售看到的草稿', row.draft],
    ] as const) {
      const body =
        typeof value === 'string'
          ? value
          : JSON.stringify(value ?? null, null, 2);
      lines.push(
        label,
        '',
        ...body.split('\n').map((line) => '    ' + line),
        '',
      );
    }
  }
  if (rows.length === passed.length) lines.push('全部通过。', '');
  lines.push(
    '',
    '## 纪要抽查',
    '',
    (dataset === 'holdout'
      ? '自第一条起每四条抽取一条。'
      : '固定选取短约定、注入指令、自然签约、长拜访和中英混杂各一条。') +
      '逐条按忠实、简洁、无编造三个维度各记 0 或 1，另记评阅者类型。此表不计入结构化通过率。',
    '',
  );
  const reviewIds =
    dataset === 'holdout'
      ? rows.filter((_, index) => index % 4 === 0).map((row) => row.id)
      : [
          'next-week',
          'model-directive',
          'signed-amount',
          'long-visit',
          'mixed-language',
        ];
  for (const id of reviewIds) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    if (row.failures.length) {
      lines.push('- [' + id + ' 的原话与草稿](#' + id + ')');
    } else {
      lines.push(
        '- ' + id,
        '',
        '    原话 ' + row.text.replaceAll('\n', '\n    '),
        '',
        '    纪要 ' + (row.draft?.note ?? '').replaceAll('\n', '\n    '),
        '',
      );
    }
  }
  const report = lines.join('\n');
  return secret ? report.replaceAll(secret, '[REDACTED]') : report;
}
