import {
  addCalendarDays,
  localDateAt,
  localTimeUtc,
} from '../follow-ups/follow-up-workbench-time';

export function communicationDueDate(
  evidence: string,
  now: string,
  timeZone: string,
): string | null {
  const today = localDateAt(new Date(now), timeZone);
  const candidates = new Set<string>();
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
    /(?<!下)下(?:一)?(?:周|星期|礼拜)([一二三四五六天日])?/gu,
  )) {
    const weekday = new Date(today + 'T00:00:00Z').getUTCDay();
    const offset = match[1]
      ? '一二三四五六日'.indexOf(match[1].replace('天', '日'))
      : 0;
    candidates.add(addCalendarDays(today, 7 - ((weekday + 6) % 7) + offset));
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
  ] as const) {
    if (evidence.includes(word)) candidates.add(addCalendarDays(today, days));
  }
  if (candidates.size !== 1) return null;
  const clocks = [
    ...evidence.matchAll(
      /(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:[:：](\d{2})|[点时](?:(\d{1,2})分|半)?)/gu,
    ),
  ];
  if (
    clocks.length > 1 ||
    (!clocks.length && /上午|下午|晚上|凌晨/u.test(evidence))
  )
    return null;
  let time = '09:00';
  if (clocks.length) {
    const [expression, period, h, m, minutes] = clocks[0];
    let hour = Number(h);
    const minute = Number(m ?? minutes ?? (expression.endsWith('半') ? 30 : 0));
    if (period && ['下午', '晚上', '中午'].includes(period) && hour < 12)
      hour += 12;
    if (period === '凌晨' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    time =
      String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }
  return (
    localTimeUtc([...candidates][0], timeZone, time)?.toISOString() ?? null
  );
}
