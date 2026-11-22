import type { AiProvider, AiProviderEvent } from '../ai-provider';
import { communicationDueDate } from '../communication-date';

type Input = Parameters<AiProvider['streamTurn']>[0];
type Data = Record<string, unknown>;
const data = (v: unknown): Data =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Data) : {};
const list = (v: unknown): Data[] => (Array.isArray(v) ? v.map(data) : []);
function json(s: string | undefined) {
  try {
    return data(JSON.parse(s ?? ''));
  } catch {
    return {};
  }
}
function contextAfter(system: string, line: string) {
  return json(system.split(line + '\n')[1]?.split('\n')[0]);
}

/** Scripted local demo provider. It uses real registered tools and their returned IDs. */
export async function* simulateAssistant(
  input: Input,
): AsyncGenerator<AiProviderEvent> {
  const page = contextAfter(
    input.system,
    'Current verified page (untrusted display text):',
  );
  const clock = contextAfter(
    input.system,
    'Trusted company time context for this turn:',
  );
  const last = input.messages.at(-1)?.content ?? '';
  const answer = data(json(last).validatedAnswer);
  const original = Object.keys(answer).length
    ? (input.messages.at(-2)?.content ?? '')
    : last;
  const text =
    typeof answer.otherText === 'string' ? answer.otherText : original;
  const objectCode =
    typeof page.objectCode === 'string' ? page.objectCode : 'customers';
  let recordId =
    typeof answer.recordId === 'string'
      ? answer.recordId
      : typeof page.recordId === 'string'
        ? page.recordId
        : undefined;
  let seq = 0;
  const call = async (name: string, args: Data) => {
    const tool = input.tools.find((t) => t.name === name);
    if (!tool) throw new Error('Tool unavailable');
    const result = await tool.execute(args, 'demo-' + ++seq);
    if (data(result).unavailable) throw new Error('Tool unavailable');
    return result;
  };
  const ask = (args: Data) => call('ask_user', args);
  const choose = (options: string[]) => ask({ kind: 'choose_option', options });
  const propose = (args: Data) =>
    call('propose_change', { objectCode, recordId, ...args });
  const requestsFieldChange =
    /改成|改为|设成|设为|设置为|更新为|换成|调整为|(?:^|请|帮我)(?:修改|编辑|更新|设置|调整).*字段|字段.*清空/.test(
      text,
    );
  let output = '';
  try {
    if (/模拟服务不可用/.test(text)) {
      yield { type: 'FAILED', code: 'AI_PROVIDER_UNAVAILABLE' };
      return;
    }
    if (
      /负责人.{0,8}(改|换|设)|(?:转交|转给|改派|交给)|(?:改|换|设).{0,6}负责人|内部毛利|secretMargin|忽略.{0,8}(要求|指令)/i.test(
        text,
      )
    ) {
      output = '无法通过助手更改负责人、访问受限字段或转交跟进。';
    } else if (
      /(推到|改期|顺延|延到|改到|挪到|改为下周)/.test(text) &&
      /跟进|待办/.test(text)
    ) {
      output = '助手目前不能修改已有待办的日期，请在跟进待办里调整。';
    } else if (answer.kind === 'fill_fields' && recordId) {
      await propose({ operationType: 'UPDATE_RECORD', values: answer.values });
    } else if (/简报|什么情况|进展如何|概况/.test(text) && recordId) {
      const target = { objectCode, recordId };
      const record = data(await call('get_record', target));
      const activities = list(
        data(await call('list_activities', target)).items,
      );
      const tasks = list(await call('list_followups', target));
      const claim = (text: string, source: string) => ({ text, source });
      await call('present_brief', {
        overview: [
          claim(
            typeof record.title === 'string' ? record.title : '当前客户',
            'record',
          ),
        ],
        progress: [
          claim('可见沟通记录 ' + activities.length + ' 条', 'activities'),
        ],
        risks: [
          claim(
            tasks.length
              ? '仍有跟进事项，需核对处理进度。'
              : '当前未查到跟进事项，后续安排待确认。',
            'followups',
          ),
        ],
        next: [
          claim(
            tasks.length
              ? '建议先核对最近跟进事项。'
              : '建议确认下一次联系时间。',
            'followups',
          ),
        ],
      });
    } else if (
      /各|每个|每位|批量|全部|都/.test(text) &&
      /跟进/.test(text) &&
      /新增|新建|创建|添加|安排|各建/.test(text)
    ) {
      const fields = list(
        data(await call('describe_object', { objectCode })).fields,
      );
      const stage = fields.find(
        (f) => f.label === '阶段' || f.fieldKey === 'stage',
      );
      const quote =
        stage &&
        list(stage.options).find(
          (o) => o.label === '报价' || o.key === 'quote',
        );
      const conditions: unknown[] = [
        { fieldKey: '$owner', operator: 'in', value: ['$me'] },
      ];
      if (text.includes('报价') && stage && quote)
        conditions.push({
          fieldKey: stage.fieldKey,
          operator: 'in',
          value: [quote.key],
        });
      const found = data(
        await call('search_records', {
          objectCode,
          filters: { version: 1, match: 'all', conditions },
          page: 1,
          limit: 21,
        }),
      );
      const rows = list(found.items);
      const dueAt = communicationDueDate(
        { kind: 'weekday', week: 'next', weekday: 1, time: null },
        String(clock.currentInstant),
        String(clock.timezone),
      );
      if (Number(found.total) > 20)
        output = '匹配超过 20 项，请缩小范围后重新生成。';
      else if (found.total !== rows.length || !dueAt || !rows.length)
        output = '没有完整的可用目标或日期，未创建跟进。';
      else
        for (const row of rows)
          await propose({
            recordId: row.id,
            operationType: 'CREATE_FOLLOW_UP',
            title: '联系客户',
            dueAt,
          });
    } else if (
      (/张三/.test(text) && /阶段|谈判/.test(text) && /改|设|调/.test(text)) ||
      /阶段.{0,4}(改|设|调)|改成谈判/.test(text)
    ) {
      if (!recordId) {
        const rows = list(
          data(await call('search_records', { objectCode, query: '张三' }))
            .items,
        );
        if (rows.length > 1) {
          await ask({
            kind: 'choose_record',
            objectCode,
            recordIds: rows.map((r) => r.id),
          });
          return;
        }
        recordId = typeof rows[0]?.id === 'string' ? rows[0].id : undefined;
      }
      if (recordId) {
        const fields = list(
          data(await call('describe_object', { objectCode })).fields,
        );
        const stage = fields.find(
          (f) => f.label === '阶段' || f.fieldKey === 'stage',
        );
        const option = list(stage?.options).find(
          (o) => typeof o.label === 'string' && text.includes(o.label),
        );
        if (stage && option)
          await propose({
            operationType: 'UPDATE_RECORD',
            values: { [String(stage.fieldKey)]: option.key },
          });
        else
          await ask({
            kind: 'fill_fields',
            objectCode,
            recordId,
            fieldKeys: stage ? [stage.fieldKey] : [],
          });
      } else output = '没有可用的目标记录。';
    } else if (
      !requestsFieldChange &&
      /改一下|改一改|更新一下|修改客户|编辑这|帮我改/.test(text) &&
      recordId
    ) {
      await ask({ kind: 'fill_fields', objectCode, recordId, fieldKeys: [] });
    } else if (/预算|谈完|原话|记录.*[：:]|下周再联系/.test(text) && recordId) {
      await call('draft_communication', { text });
    } else if (
      /记一下|本次沟通|整理沟通|帮我记|怎么处理/.test(text) &&
      recordId
    ) {
      if (answer.label) output = '请贴入沟通原话。';
      else await choose(['仅记纪要', '整理纪要并建议跟进']);
    } else if (/找|筛选|筛出|列出/.test(text) && page.objectCode && !recordId) {
      if (text === '帮我筛选' && typeof answer.label === 'string')
        await call('preview_filter', { text: answer.label });
      else if (text === '帮我筛选')
        await choose(['只看我负责的客户', '查看今天待跟进的客户']);
      else await call('preview_filter', { text });
    } else if (requestsFieldChange) {
      output = '当前没有可用的修改项，请核对可编辑字段。';
    } else if (/字段/.test(text) && page.objectCode) {
      output =
        '可用字段：' +
        list(data(await call('describe_object', { objectCode })).fields)
          .map((f) => f.label)
          .join('、');
    } else if (/这个客户|这条记录/.test(text) && !recordId) {
      await choose(['按名称查找客户', '打开客户详情后继续']);
    } else if (/哪|怎么|几种|两种/.test(text) && !answer.label) {
      await choose(['查询当前情况', '整理沟通后再决定']);
    } else output = '测试回答';
    if (output) yield { type: 'TEXT_DELTA', text: output };
    yield { type: 'COMPLETED' };
  } catch {
    if (!input.abortSignal.aborted)
      yield { type: 'FAILED', code: 'AI_TURN_FAILED' };
  }
}
