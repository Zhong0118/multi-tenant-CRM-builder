import type { AssistantPageHint } from '@crm/contracts';
import { z } from 'zod';
import type { AiProviderTool } from './ai-provider';

const source = z.enum(['record', 'activities', 'followups']);
const claims = z
  .array(z.strictObject({ text: z.string().trim().min(1).max(450), source }))
  .max(5);
const schema = z.strictObject({
  overview: claims,
  progress: claims,
  risks: claims,
  next: claims,
});
const labels = {
  overview: '概况',
  progress: '当前进展',
  risks: '风险',
  next: '建议下一步',
} as const;

export class AssistantBrief {
  private readonly available = new Set<string>();
  content?: string;
  constructor(private readonly page: AssistantPageHint) {}
  observe(name: string, input: unknown, result: unknown) {
    if (
      !input ||
      typeof input !== 'object' ||
      !('objectCode' in input) ||
      input.objectCode !== this.page.objectCode ||
      !('recordId' in input) ||
      input.recordId !== this.page.recordId
    )
      return;
    if (
      name === 'get_record' &&
      result &&
      typeof result === 'object' &&
      'id' in result &&
      result.id === this.page.recordId
    )
      this.available.add('record');
    if (
      name === 'list_activities' &&
      result &&
      typeof result === 'object' &&
      'items' in result &&
      Array.isArray(result.items)
    )
      this.available.add('activities');
    if (name === 'list_followups' && Array.isArray(result))
      this.available.add('followups');
  }
  readonly tool: AiProviderTool = {
    name: 'present_brief',
    description:
      'Render a four-part sourced brief of the current record. Read get_record, list_activities and list_followups for this record first. Use only those successful sources. Send empty arrays if unknown. No links in text.',
    inputSchema: schema,
    execute: (raw) => {
      const input = schema.parse(raw);
      this.content = (Object.keys(labels) as (keyof typeof labels)[])
        .map((key) => {
          const lines = input[key]
            .filter(
              (c) =>
                this.available.has(c.source) &&
                !/[\r\n<>]|https?:\/\/|\]\(/iu.test(c.text),
            )
            .map(
              (c) =>
                (key === 'risks' || key === 'next' ? '推断 · ' : '') +
                c.text +
                ' 【' +
                { record: '记录', activities: '活动', followups: '跟进' }[
                  c.source
                ] +
                '】',
            );
          return (
            '## ' + labels[key] + '\n' + (lines.join('\n') || '暂无可见依据')
          );
        })
        .join('\n\n');
      return Promise.resolve({ presented: true });
    },
  };
}
