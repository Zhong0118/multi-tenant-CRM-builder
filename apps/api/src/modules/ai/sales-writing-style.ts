import type { WritingDraft, WritingOptions } from '@crm/contracts';
import type { SalesFact } from './sales-draft-output';

export const writingSentences = (text: string) =>
  (text.match(/[^。！？!?\n]+[。！？!?]?/gu) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

export const customerDirected = (text: string) =>
  /(?:^|[：:。！？])(?:[\p{Script=Han}]{1,5}(?:总|经理|先生|女士|老师))[，,：:！!]|您好|你好|您|你(?:们)?|贵(?:司|方|公司|单位|团队|部门|校|院|行)|敬启|烦请|劳烦|麻烦(?:确认|安排|提供|查收|告知|看)|请(?:问|予|帮忙|确认|查阅|查收|安排|提供|告知|回复|协助|审阅|过目|核实|核对)|(?:能否|可否)(?:帮忙|告知|提供)|方便(?:安排|告知|透露|回复).*吗/u.test(
    text,
  );

// Expressions of ownership require evidence for the same party and role/action.
const parties = [
  '我方|我司|我公司|我们(?:公司|这边)?|本公司',
  '对方|客户(?:方)?|贵司|贵方|贵公司|你们(?:公司)?|您(?:方|公司|这边)?',
];
const owned =
  '(?:的|这边的?)?(财务|采购|技术|法务|销售|仓库|负责人|团队|内部|(?:已经|正在|仍在|还在|已|尚未|仍未|希望|需要|要求)(?:收到|核对|审批|签字|签署|付款|准备|提供|确认|比较|安排))';
export function unsupportedAttribution(text: string, evidence: string) {
  return parties.some((party) => {
    const mentions = new RegExp('(?:' + party + ')' + owned, 'gu');
    const sourceClaims = [...evidence.matchAll(mentions)].map((m) => m[1]);
    return [...text.matchAll(mentions)].some(
      (m) => !sourceClaims.includes(m[1]),
    );
  });
}

const purposeLabels: Record<WritingOptions['purpose'], string> = {
  followup: '了解当前进展和后续安排',
  invite: '了解沟通意向和可安排的时间',
  quote: '确认报价需求及待补信息',
  payment: '了解付款进度及待办事项',
  thanks: '感谢此前协助并了解后续需求',
  other: '明确本次沟通需要确认的事项',
};

export function visitOutline(
  blocks: WritingDraft['blocks'],
  options: WritingOptions,
  facts: SalesFact[],
  check: (text: string, evidence: string) => string,
): WritingDraft {
  const target = facts.find((f) => f.id === 'F1');
  const name = target?.text.replace(/^名称[：:]\s*/u, '');
  const sources = new Map(facts.map((f) => [f.id, f]));
  const known = new Map<string, SalesFact>();
  const questions: WritingDraft['blocks'] = [];
  const materials: WritingDraft['blocks'] = [];
  let purpose = {
    text: purposeLabels[options.purpose],
    factRefs: [] as string[],
  };
  for (const block of blocks) {
    if (block.factRefs.some((id) => !sources.has(id))) continue;
    const match = /^(目的|情况|问题|材料)[：:]\s*(.+)$/u.exec(block.text);
    if (!match) continue;
    const [, section, text] = match;
    const refs = [...new Set(block.factRefs)];
    const cited = refs.map((id) => sources.get(id)!);
    const evidence = cited.map((f) => f.text).join('\n');
    if (customerDirected(text) || unsupportedAttribution(text, evidence))
      continue;
    if (section === '情况') {
      for (const fact of cited) {
        if (
          fact.id !== 'F1' &&
          !customerDirected(fact.text) &&
          fact.text !== name &&
          fact.text !== target?.text
        )
          known.set(fact.id, fact);
      }
    } else if (section === '材料') {
      const item = text.replace(/[。.]$/u, '').trim();
      const source = cited.find((f) =>
        f.text.split(/[，,。；;！？\n]/u).some((part) => {
          const index = part.indexOf(item);
          if (
            index < 0 ||
            /不用|不必|不要|无需|未(?:要求|准备)|尚未|取消/u.test(part)
          )
            return false;
          const before = part.slice(0, index);
          return (
            /带上|带来|携带|备好|准备|索要|希望(?:拿到|提供)|要求(?:提供|带)/u.test(
              before,
            ) ||
            (/需要/u.test(before) &&
              /单|书|册|表|图|方案|合同|协议|样品|材料|资料|报告|说明/u.test(
                item,
              ))
          );
        }),
      );
      if (source) materials.push({ text: item, factRefs: [source.id] });
    } else if (
      writingSentences(text).length === 1 &&
      check(text, evidence) === text
    ) {
      if (section === '目的') purpose = { text, factRefs: refs };
      if (section === '问题' && /[？?]$/u.test(text))
        questions.push({ text, factRefs: refs });
    }
  }
  const line = (text: string) => ({ text, factRefs: [] as string[] });
  return {
    kind: 'visit',
    blocks: [
      {
        text: '拜访对象和目的：' + (name ? name + ' · ' : '') + purpose.text,
        factRefs: [
          ...new Set([...(target ? [target.id] : []), ...purpose.factRefs]),
        ],
      },
      line('已知情况'),
      ...Array.from(known.values(), (f) => ({
        text: f.text + '（来源：' + (f.source ?? '记录资料') + '）',
        factRefs: [f.id],
      })),
      line('要问的问题'),
      ...(questions.length
        ? questions
        : [line('本次沟通有哪些事项需要优先确认？')]),
      line('要带的材料'),
      ...materials,
    ],
  };
}
