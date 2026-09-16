/**
 * Tenant-calendar bucket boundaries for the personal Follow-up Workbench.
 *
 * "Today" is the tenant's calendar day, not the UTC day and not the viewer's
 * browser day, and adding days is calendar arithmetic — never `+ N * 24h`,
 * which drifts across a DST transition. The offline strategy mirrors the web
 * `dashboard-timezone.ts` helper: probe the zone for the offsets in effect
 * around the target instant, then keep the candidates that really land on the
 * requested local date.
 */
export interface FollowUpWorkbenchRange {
  todayStart: Date;
  tomorrowStart: Date;
  day8Start: Date;
}

interface WallClock {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

const HOUR = 60 * 60 * 1000;

export function isValidFollowUpTimeZone(
  value: string | null,
): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function followUpWorkbenchRange(
  now: Date,
  timeZone: string,
): FollowUpWorkbenchRange {
  if (!isValidFollowUpTimeZone(timeZone)) {
    throw new Error('Invalid tenant timezone');
  }

  const today = localDateAt(now, timeZone);
  return {
    todayStart: localMidnightUtc(today, timeZone),
    tomorrowStart: localMidnightUtc(addCalendarDays(today, 1), timeZone),
    day8Start: localMidnightUtc(addCalendarDays(today, 8), timeZone),
  };
}

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function wallClockAt(instant: Date, formatter: Intl.DateTimeFormat): WallClock {
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = part('hour');
  const minute = part('minute');
  const second = part('second');
  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error('Unable to format tenant wall-clock time');
  }
  return { year, month, day, hour, minute, second };
}

function localDateAt(now: Date, timeZone: string): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid instant');
  const clock = wallClockAt(now, wallClockFormatter(timeZone));
  return `${clock.year}-${clock.month}-${clock.day}`;
}

function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * The first real UTC instant that belongs to `dateText` in the tenant zone —
 * normally local midnight, and when a DST gap removes local midnight (clocks
 * jump 00:00 → 01:00) the first instant that does exist on that day. Taking the
 * earliest candidate keeps the bucket boundaries monotone and non-overlapping.
 */
function localMidnightUtc(dateText: string, timeZone: string): Date {
  const formatter = wallClockFormatter(timeZone);
  const naiveEpoch = Date.parse(`${dateText}T00:00:00.000Z`);
  const offsets = new Set<number>();

  for (let distance = -48; distance <= 48; distance += 1) {
    const probe = new Date(naiveEpoch + distance * HOUR);
    const clock = wallClockAt(probe, formatter);
    offsets.add(
      Date.parse(
        `${clock.year}-${clock.month}-${clock.day}T${clock.hour}:${clock.minute}:${clock.second}.000Z`,
      ) - probe.getTime(),
    );
  }

  const candidates = Array.from(offsets)
    .map((offset) => new Date(naiveEpoch - offset))
    .filter((candidate) => {
      const clock = wallClockAt(candidate, formatter);
      return `${clock.year}-${clock.month}-${clock.day}` === dateText;
    })
    .sort((left, right) => left.getTime() - right.getTime());

  if (!candidates.length) throw new Error('Unable to resolve tenant midnight');
  return candidates[0];
}
