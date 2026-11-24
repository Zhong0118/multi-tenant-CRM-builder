// Preserve complete source clauses, including negation. If a note has no short
// usable excerpt, the activity type and its recorded outcome still stand alone.
export function reportCommunication(
  recordTitle: string,
  activity: string,
  content: string,
  resultKey?: string | null,
) {
  const outcomes: Record<string, string> = {
    CONNECTED: '已取得联系',
    WECHAT_ADDED: '已添加微信',
    NOT_REACHED: '未取得联系',
  };
  const title = recordTitle.replace(/\s+/gu, ' ').trim();
  const clauses = (content.match(/[^\r\n。；！？!?]+[？?]?/gu) ?? [])
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length >= 2 &&
        s.length <= 44 &&
        !/[【】]/u.test(s) &&
        s.replace(/^.{1,20}[：:]\s*/u, '').replace(/[：:,，\s]+$/u, '') !==
          title &&
        !/^(?:问题|计划)[：:]|^(?:您好|你好|谢谢|感谢|此致|敬礼)[，,\s]*$/u.test(
          s,
        ),
    );
  const result = clauses.findLast((s) => /^(?:结果|反馈)[：:]/u.test(s));
  const details = [
    clauses.find((s) => s !== result),
    result ?? (clauses.length > 1 ? clauses.at(-1) : undefined),
    outcomes[resultKey ?? ''],
  ]
    .filter((s): s is string => !!s)
    .map((s) => s.replace(/^(?:结果|反馈|沟通|内容)[：:]\s*/u, ''))
    .map((s) => (/[？?]$/u.test(s) ? '询问「' + s + '」' : s));
  const label = [activity, ...new Set(details)].filter(Boolean);
  return (
    title +
    '：' +
    label[0] +
    (label.length > 1 ? '，' + label.slice(1).join('；') : '') +
    '。'
  );
}
