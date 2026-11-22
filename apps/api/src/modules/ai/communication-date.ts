import {
  addCalendarDays,
  localDateAt,
  localTimeUtc,
} from '../follow-ups/follow-up-workbench-time';

const clauseBoundary = /[，,。；;！？!?\n]/u;
const uncertainPlan = /可能|不一定|不确定|待定|看情况|节后|假期后/u;
const cancelledPlan =
  /(?:不需要|不用|不必|不要|不能|不再|暂不|不是|别|取消)(?:再|在|于|原定|了)?(?:[今明后]天|过两天|[上下本这]?(?:周|星期|礼拜)|月[末底]|联系|跟进|回电|打电话|致电|回访|安排)|(?:跟进|回访|电话|约定|会议|安排|预约)(?:已经|已)?取消/u;

function clockNumber(value: string): number {
  if (/^\d+$/u.test(value)) return Number(value);
  const digits = '零一二三四五六七八九';
  const normalized = value.replace('两', '二');
  if (normalized.length === 1 && normalized !== '十')
    return digits.indexOf(normalized);
  const match = /^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/u.exec(
    normalized,
  );
  return match
    ? digits.indexOf(match[1] || '一') * 10 + digits.indexOf(match[2] || '零')
    : -1;
}

function followUpClause(evidence: string, source: string): string | null {
  // A short quote such as “明天跟进” can belong to the clause “不用明天跟进”.
  const at = source.indexOf(evidence);
  if (!evidence.trim() || at < 0) return null;
  const clause =
    (source.slice(0, at).split(clauseBoundary).at(-1) ?? '') +
    evidence +
    source.slice(at + evidence.length).split(clauseBoundary, 1)[0];
  return cancelledPlan.test(clause) ? null : clause;
}

export function supportsFollowUpEvidence(
  evidence: string,
  source: string,
): boolean {
  return followUpClause(evidence, source) !== null;
}

export function communicationDueDate(
  evidence: string,
  now: string,
  timeZone: string,
  source = evidence,
): string | null {
  const clause = followUpClause(evidence, source);
  if (clause === null || uncertainPlan.test(clause)) return null;
  const due = quotedDate(evidence, now, timeZone);
  if (due && clause !== evidence && quotedDate(clause, now, timeZone) !== due)
    return null;
  return due;
}

function quotedDate(
  quote: string,
  now: string,
  timeZone: string,
): string | null {
  // The date of a referenced document is not a proposed contact date.
  const evidence = quote.replace(/(?:对照|参照|参考|根据)[今明后]天的/gu, '');
  const today = localDateAt(new Date(now), timeZone);
  const candidates = new Set<string>();
  let hasWeekday = false;
  for (const part of evidence.matchAll(
    /(\d{4})[-年](\d{1,2})[-月](\d{1,2})日?/gu,
  )) {
    const date =
      part[1] + '-' + part[2].padStart(2, '0') + '-' + part[3].padStart(2, '0');
    const instant = new Date(date + 'T00:00:00Z');
    if (
      !Number.isFinite(instant.getTime()) ||
      instant.toISOString().slice(0, 10) !== date
    )
      return null;
    candidates.add(date);
  }
  for (const match of evidence.matchAll(
    /(下下|上上|下(?:一)?|上(?:一)?|本|这)?(?:周|星期|礼拜)([一二三四五六天日末])?/gu,
  )) {
    const [, week, day] = match;
    if (week?.startsWith('上') || week === '下下' || day === '末') return null;
    const nextWeek = week === '下' || week === '下一';
    if (!day && !nextWeek) continue;
    const weekday = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const target = day ? '一二三四五六日'.indexOf(day.replace('天', '日')) : 0;
    let days = target - weekday;
    if (nextWeek || (!week && days < 0)) days += 7;
    candidates.add(addCalendarDays(today, days));
    hasWeekday = true;
  }
  for (const match of evidence.matchAll(/(下个?)?(?:月末|月底)/gu)) {
    const [year, month] = today.split('-').map(Number);
    candidates.add(
      new Date(Date.UTC(year, month + (match[1] ? 1 : 0), 0))
        .toISOString()
        .slice(0, 10),
    );
  }
  for (const [word, days] of [
    ['今天', 0],
    ['明天', 1],
    ['后天', 2],
    ['过两天', 2],
    ['过2天', 2],
  ] as const) {
    if (evidence.includes(word)) candidates.add(addCalendarDays(today, days));
  }
  if (candidates.size !== 1) return null;
  const clocks = [
    ...evidence.matchAll(
      /(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2}|[零一二两三四五六七八九十]+)(?:[:：](\d{2})|[点时](?:(\d{1,2}|[零一二两三四五六七八九十]+)分|半)?)/gu,
    ),
  ];
  if (
    clocks.length > 1 ||
    (!clocks.length && /早上|上午|中午|下午|晚上|凌晨/u.test(evidence))
  )
    return null;
  let time = '09:00';
  if (clocks.length) {
    const [expression, period, h, m, minutes] = clocks[0];
    let hour = clockNumber(h);
    const minute = clockNumber(
      m ?? minutes ?? (expression.endsWith('半') ? '30' : '0'),
    );
    if (hour < 0 || minute < 0) return null;
    if (period && ['下午', '晚上', '中午'].includes(period) && hour < 12)
      hour += 12;
    if (period === '凌晨' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    time =
      String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }
  const due = localTimeUtc([...candidates][0], timeZone, time);
  if (!due || (hasWeekday && due.getTime() < Date.parse(now))) return null;
  return due.toISOString();
}
