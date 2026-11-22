import {
  addCalendarDays,
  followUpLocalDateTime,
  localTimeUtc,
} from '../follow-ups/follow-up-workbench-time';
import {
  communicationDateExpressionSchema,
  type CommunicationDateExpression,
} from './communication-output';

const maxDays = 90;
const periodClocks = new Map([
  ['morning', '09:00'],
  ['afternoon', '14:00'],
  ['evening', '19:00'],
]);

export function communicationDueDate(
  expression: CommunicationDateExpression,
  now: string,
  timeZone: string,
): string | null {
  if (
    expression.kind === 'unknown' ||
    !communicationDateExpressionSchema.safeParse(expression).success
  )
    return null;

  const instant = new Date(now);
  const localNow = followUpLocalDateTime(instant, timeZone);
  const today = localNow.slice(0, 10);
  let date: string;
  switch (expression.kind) {
    case 'absolute':
      date = expression.date;
      break;
    case 'relativeDays':
      if (expression.days > maxDays) return null;
      date = addCalendarDays(today, expression.days);
      break;
    case 'weekday': {
      const weekday = new Date(today + 'T00:00:00Z').getUTCDay() || 7;
      const days =
        expression.weekday - weekday + (expression.week === 'next' ? 7 : 0);
      date = addCalendarDays(today, days);
      break;
    }
    case 'monthEnd': {
      const [year, month] = today.split('-').map(Number);
      date = new Date(
        Date.UTC(year, month + (expression.month === 'next' ? 1 : 0), 0),
      )
        .toISOString()
        .slice(0, 10);
      break;
    }
  }

  // The last permitted minute is the same local clock time 90 calendar days later.
  const time =
    expression.time === null
      ? '09:00'
      : (periodClocks.get(expression.time) ?? expression.time);
  const lastMinute =
    addCalendarDays(today, maxDays) + 'T' + localNow.slice(11, 16);
  if (date < today || date + 'T' + time > lastMinute) return null;
  const due = localTimeUtc(date, timeZone, time);
  return due && due >= instant ? due.toISOString() : null;
}
