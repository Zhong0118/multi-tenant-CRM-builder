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
): string {
  const passed = rows.filter((row) => !row.failures.length);
  const lines = [
    '# 沟通草稿结构化评测',
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
  const report = lines.join('\n');
  return secret ? report.replaceAll(secret, '[REDACTED]') : report;
}
