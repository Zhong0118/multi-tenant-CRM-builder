import {
  communicationDueDate,
  supportsFollowUpEvidence,
} from './communication-date';

const now = '2026-11-24T02:00:00.000Z'; // Tuesday, 10:00 in Shanghai
const zone = 'Asia/Shanghai';

describe('quoted follow-up date in the tenant calendar', () => {
  it.each([
    ['周三下午三点再打', '2026-11-25T07:00:00.000Z'],
    ['周一上午十点半联系', '2026-11-30T02:30:00.000Z'],
    ['星期二下午三点半致电', '2026-11-24T07:30:00.000Z'],
    ['下周一上午十一点十五分联系', '2026-11-30T03:15:00.000Z'],
    ['过两天再联系', '2026-11-26T01:00:00.000Z'],
    ['月底前给答复', '2026-11-30T01:00:00.000Z'],
    ['预算还没批，下周再联系', '2026-11-30T01:00:00.000Z'],
    ['下周三再联系，参照今天的方案确认数量', '2026-12-02T01:00:00.000Z'],
  ])('%s', (evidence, expectedUtc) => {
    expect(communicationDueDate(evidence, now, zone)).toBe(expectedUtc);
  });

  it.each([
    '周二早上八点再打', // bare weekday is today but the time has passed
    '节后再约',
    '最近再说',
    '有需要再找你们',
    '上周五联系过',
    '下周末联系',
    '下周可能再联系',
    '先别下周联系',
    '明天不用跟进',
    '月底或者节后再约',
    '周三或周五再联系',
    '周三下午再打', // no specific hour
    '周三早上再联系',
    '明天致电，参考今天的清单后天跟进',
  ])('leaves the date open for %s', (evidence) => {
    expect(communicationDueDate(evidence, now, zone)).toBeNull();
  });

  it('checks if a quoted date came from a cancelled plan', () => {
    expect(
      communicationDueDate(
        '明天跟进',
        now,
        zone,
        '客户说不用明天跟进，等他回电',
      ),
    ).toBeNull();
  });

  it('can quote a replacement plan in a separate clause', () => {
    expect(
      communicationDueDate(
        '过两天再联系',
        now,
        zone,
        '明天不用跟进，过两天再联系',
      ),
    ).toBe('2026-11-26T01:00:00.000Z');
  });

  it.each([
    ['明天', '明天或者后天再联系'],
    ['周三', '周三下午三点再打'],
  ])('drops an incomplete date quote from %s', (quote, text) => {
    expect(communicationDueDate(quote, now, zone, text)).toBeNull();
  });

  it.each<[string, string, boolean]>([
    ['明天', '明天不需要再联系了，客户会主动发邮件', false],
    ['回访', '周三的回访已取消', false],
    ['过两天联系', '明天不用跟进，过两天联系', true],
    ['下周', '不确定下周是否能联系', true],
    ['周五', '周三回访', false],
  ])(
    'checks whether the quote %s belongs to a live plan',
    (quote, source, expected) => {
      expect(supportsFollowUpEvidence(quote, source)).toBe(expected);
    },
  );

  it('uses the local date after UTC midnight and across the month boundary', () => {
    // January 31 in Los Angeles although it is already February 1 UTC.
    expect(
      communicationDueDate(
        '过两天回电',
        '2027-02-01T02:30:00.000Z',
        'America/Los_Angeles',
      ),
    ).toBe('2027-02-02T17:00:00.000Z');
  });
});
