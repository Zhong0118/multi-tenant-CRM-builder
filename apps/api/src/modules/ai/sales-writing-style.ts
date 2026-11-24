import type { WritingDraft, WritingOptions } from '@crm/contracts';
import type { SalesFact } from './sales-draft-output';

export const writingSentences = (text: string) =>
  (text.match(/[^。！？!?\n]+[。！？!?]?/gu) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

export const nonInternalVoice = (text: string) =>
  /(?<!自)我|咱|本人|本公司|(?:^|[：:。！？])(?:[\p{Script=Han}]{1,5}(?:总|经理|先生|女士|老师))[，,：:！!]|您好|你好|您|你(?:们)?|贵(?:司|方|公司|单位|团队|部门|校|院|行)|敬启|烦请|劳烦|麻烦(?:确认|安排|提供|查收|告知|看)|请(?:问|予|帮忙|确认|查阅|查收|安排|提供|告知|回复|协助|审阅|过目|核实|核对)|(?:能否|可否)(?:帮忙|告知|提供)|方便(?:安排|告知|透露|回复).*吗/u.test(
    text,
  );

// Expressions of ownership require evidence for the same party and role/action.
const parties = [
  '我方|我司|我公司|我们(?:公司|这边)?|本公司',
  '对方|客户(?:方)?|贵司|贵方|贵公司|你们(?:公司)?|您(?:方|公司|这边)?',
  '供应商',
  '第三方',
  '合作方',
];
const owned =
  '(?:的|这边的?)?(财务|采购|技术|法务|销售|仓库|负责人|团队|内部|(?:已经|正在|仍在|还在|已|尚未|仍未|希望|需要|要求)(?:收到|核对|审批|签字|签署|付款|准备|提供|确认|比较|安排))';
export function unsupportedAttribution(text: string, evidence: string) {
  return parties.some((party) => {
    const mentions = new RegExp('(?:' + party + ')' + owned, 'gu');
    const sourceClaims = [...evidence.matchAll(mentions)].map((m) => m[1]);
    if ([...text.matchAll(mentions)].some((m) => !sourceClaims.includes(m[1])))
      return true;
    // Preserve who the work is being performed for, even when the department
    // precedes the party ('财务替我司核对', '采购代表客户签收').
    const beneficiary = new RegExp(
      '(?:替|帮(?:助|忙)?|为|代表|代|协助|受)(?:' + party + ')',
      'gu',
    );
    const claims = (line: string) =>
      line.split(/[，,。！？；;：:\n]/u).flatMap((clause) => {
        const normalized = clause.trim().replace(beneficiary, '〔归属〕');
        return normalized.includes('〔归属〕') ? [normalized] : [];
      });
    const cited = claims(evidence);
    return claims(text).some((claim) => !cited.includes(claim));
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

// A material becomes a packing item only when the note assigns that action
// to sales, or records an unqualified packing instruction for the visit.
function assignedMaterial(fact: string, item: string) {
  return fact.split(/[。！？；;\n]/u).some((line) => {
    const index = line.indexOf(item);
    if (
      index < 0 ||
      /不要|不必|无需|不用|不需要|不负责|尚未|暂缓|取消|能否|是否|待确认/u.test(
        line,
      )
    )
      return false;
    const before = line
      .slice(0, index)
      .replace(/^.*?(?:沟通|跟进|补充)[：:]\s*/u, '');
    const action =
      /(?:带上|携带|带来|带去|备好|准备好?|带)(?:一份|一套|一件)?\s*$/u.exec(
        before,
      );
    if (!action) return false;
    const prefix = before.slice(0, action.index);
    const modifiers =
      /(?:届时|到时|在?(?:本次|下次)?(?:拜访|会面|到场|见面)(?:时|前)|提前|务必|记得|负责|需要|应当|需|要|将|会|请|应|在现场|\s)+$/u;
    const assignee = prefix.replace(modifiers, '');
    if (!assignee)
      return (
        /带上|携带|带来|带去|备好/u.test(action[0]) ||
        /拜访|会面|到场|见面/u.test(prefix)
      );
    return /(?:^|要求|请|通知|安排|希望|交由|由)(?:销售(?:人员|代表|方)?|我司|我方|我们)$/u.test(
      assignee,
    );
  });
}

export function specificVisitQuestion(
  text: string,
  facts: SalesFact[],
  purpose: WritingOptions['purpose'],
) {
  if (!/[？?]$/u.test(text) || nonInternalVoice(text)) return false;
  const purposeTopic = {
    followup: '',
    invite: '邀请',
    quote: '报价',
    payment: '付款',
    thanks: '致谢',
    other: '',
  }[purpose];
  if (purposeTopic && text.includes(purposeTopic)) return true;
  const subjects = facts
    .filter((f) => f.id !== 'F1')
    .map((f) => f.text)
    .join('\n');
  const words = new Intl.Segmenter('zh', { granularity: 'word' }).segment(text);
  const generic =
    /^(?:什么|怎么|如何|是否|能否|哪些|哪个|这次|本次|目前|当前|现在|还有|需要|希望|确认|了解|具体|情况|事项|进展|进度|安排|问题|相关|沟通|优先|本身|客户|对方|可以|已经|正在|后续|跟进|下一步|信息|细节)$/u;
  return [...words].some(
    ({ segment, isWordLike }) =>
      isWordLike &&
      segment.length >= 2 &&
      !generic.test(segment) &&
      subjects.includes(segment),
  );
}

export function visitOutline(
  blocks: WritingDraft['blocks'],
  options: WritingOptions,
  facts: SalesFact[],
  check: (text: string, evidence: string) => string,
): WritingDraft {
  const target = facts.find((f) => f.id === 'F1');
  const name = target?.text.replace(/^名称[：:]\s*/u, '');
  const sources = new Map(facts.map((f) => [f.id, f]));
  const usableFacts = facts.filter(
    (f) =>
      f.id !== 'F1' &&
      f.text !== name &&
      f.text !== target?.text &&
      !nonInternalVoice(f.text),
  );
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
    if (nonInternalVoice(text) || unsupportedAttribution(text, evidence))
      continue;
    if (section === '情况') {
      for (const fact of cited) {
        if (usableFacts.includes(fact)) known.set(fact.id, fact);
      }
    } else if (section === '材料') {
      const item = text.replace(/[。.]$/u, '').trim();
      const source = cited.find((f) => assignedMaterial(f.text, item));
      if (source) materials.push({ text: item, factRefs: [source.id] });
    } else if (
      writingSentences(text).length === 1 &&
      check(text, evidence) === text
    ) {
      if (section === '目的') purpose = { text, factRefs: refs };
      if (
        section === '问题' &&
        specificVisitQuestion(text, usableFacts, options.purpose)
      )
        questions.push({ text, factRefs: refs });
    }
  }
  if (!known.size && usableFacts.length)
    known.set(usableFacts[0].id, usableFacts[0]);
  const [firstFact] = known.values();
  if (!questions.length && firstFact)
    questions.push({
      text: '记录提到「' + firstFact.text + '」，下一步由谁负责跟进？',
      factRefs: [firstFact.id],
    });
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
