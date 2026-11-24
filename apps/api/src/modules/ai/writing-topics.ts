import type { SalesFact } from './sales-draft-output';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const common =
  /^(?:的|确认|关于|有关|情况|了解|咨询|询问|安排|相关|目前|是否|事宜|事项|沟通|跟进|联系|本次|请问|此次|一下|已经|主题|反馈)$/u;

function words(text: string) {
  const normalized = text
    .replace(/交(?:付|货)(?:时间|日期|周期)|发货时间/gu, '交期')
    .replace(/到货日期/gu, '交期')
    .replace(/签收|收悉|接收|收货/gu, '收到');
  return [...segmenter.segment(normalized)]
    .filter((w) => w.isWordLike && !common.test(w.segment))
    .map((w) => w.segment);
}

export function coversTopic(text: string, topic: string) {
  const tokens = words(topic).filter((t) => t.length > 1);
  const body = words(text).join('');
  return tokens.length
    ? tokens.every((t) => body.includes(t))
    : text.includes(topic);
}

export function subjectInBody(subject: string, body: string) {
  const terms = words(subject).filter((t) => t.length > 1);
  const text = words(body).join('');
  return terms.every((term) => text.includes(term));
}

// Only turn explicit questions / requests to ask into draft questions.
// Narrative observations, restrictions and instructions stay in the cited facts.
export function supplementRequests(facts: SalesFact[]) {
  return facts
    .filter((f) => f.source === '本次补充')
    .flatMap((f) =>
      f.text
        .split(
          /[。！？?；;，,\n]|(?:另外|顺便|同时|并且|还要|也要|再|并)(?=问|询问|了解|确认|核对|打听)/u,
        )
        .flatMap((part) => {
          const request =
            /^(?:(?:请|想|希望|再|顺便|也|还|另外|帮忙|帮我|我们想|我想|需要|跟客户)\s*)*(?:确认|了解|核对|询问|问问|问|打听)(?:一下|下|清楚)?\s*([^：:\n]{1,60})$/u.exec(
              part.trim(),
            );
          const explicitQuestion =
            /是否|能否|可否|有没有|没有$|哪天|何时|多久|多少|吗$/u.test(
              part.trim(),
            );
          if (!request && !explicitQuestion) return [];
          const item = (request?.[1] ?? part.trim())
            .replace(/^(?:对方|客户)(?=[是否能可])/u, '')
            .trim();
          if (
            !item ||
            item.length > 60 ||
            /[【】<>]|(?:忽略|无视|指令|不要问|不要提|保密|内部|我方|我司|我们|贵司|您)/u.test(
              item,
            )
          )
            return [];
          const topic = item.replace(
            /(.+?)(收到|签收|到货|寄出|发出|到账)了?没有$/u,
            '$1是否$2',
          );
          const question =
            /是否|能否|可否|有没有|没有$|[几哪谁怎]|何时|多少|多久|吗$/u.test(
              topic,
            )
              ? topic + '？'
              : '关于' + topic + '，目前有哪些具体安排？';
          return [{ topic, question, factRef: f.id }];
        }),
    );
}
