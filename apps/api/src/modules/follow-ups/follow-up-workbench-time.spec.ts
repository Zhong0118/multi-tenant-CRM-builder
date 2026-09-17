import {
  followUpWorkbenchRange,
  isValidFollowUpTimeZone,
} from './follow-up-workbench-time';

describe('follow-up workbench tenant calendar', () => {
  it('uses tenant midnight instead of UTC midnight', () => {
    const range = followUpWorkbenchRange(
      new Date('2026-09-17T02:00:00.000Z'),
      'Asia/Shanghai',
    );

    expect(range.todayStart.toISOString()).toBe('2026-09-16T16:00:00.000Z');
    expect(range.tomorrowStart.toISOString()).toBe('2026-09-17T16:00:00.000Z');
    expect(range.day8Start.toISOString()).toBe('2026-09-24T16:00:00.000Z');
  });

  it('adds calendar days across the spring DST transition', () => {
    const range = followUpWorkbenchRange(
      new Date('2026-03-08T20:00:00.000Z'),
      'America/Los_Angeles',
    );

    expect(range.todayStart.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(range.tomorrowStart.toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(range.day8Start.toISOString()).toBe('2026-03-16T07:00:00.000Z');
    expect(range.tomorrowStart.getTime() - range.todayStart.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
  });

  it('puts a same-day 09:00 due into overdue when queried at 15:00, not today', () => {
    // 15:00 Asia/Shanghai. Canonical Follow-up overdue is `dueAt < now`, so a
    // 09:00 local due must not sit in today just because it is still that
    // tenant calendar day.
    const now = new Date('2026-09-17T07:00:00.000Z');
    const dueAt = new Date('2026-09-17T01:00:00.000Z');
    const range = followUpWorkbenchRange(now, 'Asia/Shanghai');

    expect(range.now.toISOString()).toBe(now.toISOString());
    expect(dueAt < range.now).toBe(true);
    expect(dueAt >= range.now && dueAt < range.tomorrowStart).toBe(false);
  });

  it('rejects an invalid timezone', () => {
    expect(isValidFollowUpTimeZone('Not/A_Timezone')).toBe(false);
    expect(() =>
      followUpWorkbenchRange(new Date(), 'Not/A_Timezone'),
    ).toThrow('Invalid tenant timezone');
  });
});
