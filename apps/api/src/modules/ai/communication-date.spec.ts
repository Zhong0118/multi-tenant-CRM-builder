import { communicationDueDate } from './communication-date';
import {
  communicationWireSchema,
  type CommunicationDateExpression,
} from './communication-output';

const now = '2026-11-24T02:00:00.000Z'; // Tuesday, 10:00 in Shanghai
const zone = 'Asia/Shanghai';

describe('follow-up dates in the tenant calendar', () => {
  it.each<[CommunicationDateExpression, string | null]>([
    [
      { kind: 'absolute', date: '2026-12-01', time: null },
      '2026-12-01T01:00:00.000Z',
    ],
    [{ kind: 'relativeDays', days: 2, time: null }, '2026-11-26T01:00:00.000Z'],
    [
      { kind: 'weekday', week: 'this', weekday: 3, time: '15:30' },
      '2026-11-25T07:30:00.000Z',
    ],
    [
      { kind: 'weekday', week: 'next', weekday: 1, time: '10:15' },
      '2026-11-30T02:15:00.000Z',
    ],
    [
      { kind: 'weekday', week: 'this', weekday: 7, time: '23:59' },
      '2026-11-29T15:59:00.000Z',
    ],
    [
      { kind: 'monthEnd', month: 'this', time: null },
      '2026-11-30T01:00:00.000Z',
    ],
    [
      { kind: 'monthEnd', month: 'next', time: '00:00' },
      '2026-12-30T16:00:00.000Z',
    ],
    [{ kind: 'unknown', time: null }, null],
    [{ kind: 'weekday', week: 'this', weekday: 1, time: '23:00' }, null],
    [{ kind: 'absolute', date: '2026-11-24', time: '09:59' }, null],
    [{ kind: 'relativeDays', days: 0, time: null }, null],
    [{ kind: 'relativeDays', days: 0, time: '10:00' }, now],
    [{ kind: 'absolute', date: '2026-11-31', time: null }, null],
    [{ kind: 'relativeDays', days: -1, time: null }, null],
    [{ kind: 'relativeDays', days: 1.5, time: null }, null],
    [{ kind: 'relativeDays', days: 91, time: null }, null],
    [{ kind: 'relativeDays', days: 3, time: '24:00' }, null],
    [{ kind: 'absolute', date: '2027-03-01', time: '00:00' }, null],
  ])('resolves %j', (expression, expected) => {
    expect(communicationDueDate(expression, now, zone)).toBe(expected);
  });

  it('bases month end on the local month and respects leap years', () => {
    // February 1 UTC is still January 31 in Los Angeles.
    expect(
      communicationDueDate(
        { kind: 'monthEnd', month: 'next', time: null },
        '2028-02-01T02:30:00.000Z',
        'America/Los_Angeles',
      ),
    ).toBe('2028-02-29T17:00:00.000Z');
  });

  it.each([
    ['09:00', '2026-11-08T14:00:00.000Z'],
    ['09:01', null],
  ])(
    'bounds day 90 at the original local clock across a DST change (%s)',
    (time, expected) => {
      expect(
        communicationDueDate(
          { kind: 'relativeDays', days: 90, time },
          '2026-08-10T13:00:00.000Z',
          'America/New_York',
        ),
      ).toBe(expected);
    },
  );

  it.each([
    ['2026-03-08', '02:30', '2026-03-01T00:00:00Z'], // spring gap
    ['2026-11-01', '01:30', '2026-10-20T00:00:00Z'], // autumn overlap
  ])('leaves non-unique local time %s %s open', (date, time, reference) => {
    expect(
      communicationDueDate(
        { kind: 'absolute', date, time },
        reference,
        'America/New_York',
      ),
    ).toBeNull();
  });
});

describe('structured follow-up date contract', () => {
  const draft = {
    note: 'Customer requested a call.',
    followUp: { title: 'Call', evidence: 'Call in two days' },
    fieldChanges: [],
  };

  it('accepts a typed expression with an explicitly absent time', () => {
    expect(
      communicationWireSchema.safeParse({
        ...draft,
        followUp: {
          ...draft.followUp,
          dateExpression: { kind: 'relativeDays', days: 2, time: null },
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    { kind: 'relativeDays', days: 2 },
    { kind: 'relativeDays', days: -1, time: null },
    { kind: 'weekday', week: 'next', weekday: 8, time: null },
    { kind: 'monthEnd', month: 'this', time: '9am' },
    { kind: 'unknown', date: '2026-11-25', time: null },
    { kind: 'unknown', time: '09:00' },
  ])(
    'rejects an incomplete or inconsistent expression %j',
    (dateExpression) => {
      expect(
        communicationWireSchema.safeParse({
          ...draft,
          followUp: { ...draft.followUp, dateExpression },
        }).success,
      ).toBe(false);
    },
  );
});
