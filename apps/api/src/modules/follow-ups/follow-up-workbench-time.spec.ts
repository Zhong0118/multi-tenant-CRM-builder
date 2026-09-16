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

  it('rejects an invalid timezone', () => {
    expect(isValidFollowUpTimeZone('Not/A_Timezone')).toBe(false);
    expect(() =>
      followUpWorkbenchRange(new Date(), 'Not/A_Timezone'),
    ).toThrow('Invalid tenant timezone');
  });
});
