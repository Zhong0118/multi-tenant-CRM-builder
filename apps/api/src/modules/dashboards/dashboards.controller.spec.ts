import { overviewPeriod } from './dashboards.controller';

describe('dashboard overview period', () => {
  it('defaults to the same 30-day window the workbench 近 30 天 preset builds', () => {
    const to = new Date('2026-09-14T17:06:41.809Z');
    jest.useFakeTimers().setSystemTime(to);
    try {
      const period = overviewPeriod({} as never);
      expect(period.to).toEqual(to);
      expect(period.from.toISOString()).toBe('2026-08-15T17:06:41.809Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('honours an explicit from/to range and an explicit day count', () => {
    const explicit = overviewPeriod({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
    } as never);
    expect(explicit.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(explicit.to.toISOString()).toBe('2026-01-31T00:00:00.000Z');

    const sevenDays = overviewPeriod({
      to: '2026-09-14T17:06:41.809Z',
      days: 7,
    } as never);
    expect(sevenDays.from.toISOString()).toBe('2026-09-07T17:06:41.809Z');
  });
});
