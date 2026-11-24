import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  writingOptions,
  sections,
  type SalesFact,
} from '../../../src/modules/ai/sales-draft-output';

const briefRow = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.enum(['overdue', 'reclaim', 'stagnant', 'silent']),
]);
const writingRow = z.tuple([
  z.string(),
  writingOptions.shape.kind,
  writingOptions.shape.purpose,
  writingOptions.shape.tone,
  writingOptions.shape.length,
  z.string(),
]);
const reportRow = z.strictObject({
  completed: z.array(z.string()),
  nextSteps: z.array(z.string()),
  plans: z.array(z.string()).optional(),
  problems: z.array(z.string()).optional(),
});
const samples = z.strictObject({
  daily_brief: z.array(briefRow),
  writing: z.array(writingRow),
  daily_report: z.array(reportRow),
});
const descriptions = {
  overdue: '已有跟进逾期',
  reclaim: '两天后到期收回',
  stagnant: '报价阶段已停留十五天',
  silent: '二十天未联系',
};
export async function loadCases(name: 'development' | 'holdout') {
  const data = samples.parse(
    JSON.parse(await readFile(join(__dirname, name + '.json'), 'utf8')),
  );
  return {
    daily_brief: data.daily_brief.map((_, i, rows) =>
      Array.from({ length: Math.min(6, rows.length) }, (_, j) => {
        const [, title, text, group] = rows[(i + j) % rows.length];
        const ref = 'R' + (j + 1);
        return {
          recordRef: ref,
          recordId: 'fixture-' + j,
          fingerprint: 'fixture-' + i,
          title,
          objectName: '业务记录',
          facts: [
            { ref: ref + 'F1', text: descriptions[group] },
            { ref: ref + 'F2', text },
          ],
        };
      }),
    ),
    writing: data.writing.map(([title, kind, purpose, tone, length, text]) => ({
      title,
      options: { kind, purpose, tone, length },
      facts: [
        { id: 'F1', text: '名称：' + title },
        { id: 'F2', text },
      ],
    })),
    daily_report: data.daily_report.map((day) => {
      const facts: SalesFact[] = [];
      for (const section of sections)
        for (const text of day[section] ?? [])
          facts.push({ id: 'F' + (facts.length + 1), text, section });
      return facts;
    }),
  };
}
