import { isQuotedNumber } from './communication-field-evidence';

describe('whole Chinese amount evidence', () => {
  it.each([
    ['合同金额为十二万。', '十二万', '120000'],
    ['单据为叁万陆仟元整。', '叁万陆仟元整', '36000.00'],
    ['合同金额为两千零六元。', '两千零六元', '2006'],
    ['原价十二万元，尾款二万元', '二万元', '20000'],
    ['应退负一点零五万元', '负一点零五万元', '-10500'],
    ['零头伍角贰分', '伍角贰分', '0.52'],
    ['大写玖仟萬億零壹元', '玖仟萬億零壹元', '9000000000000001'],
    [
      '总价壹亿零叁万零伍元陆角贰分。',
      '壹亿零叁万零伍元陆角贰分',
      '100030005.62',
    ],
  ])('matches %s', (text, quote, value) => {
    expect(isQuotedNumber(value, quote, text)).toBe(true);
  });

  it.each([
    ['总额十二万元', '二万', '20000'],
    ['总额十二万元', '十二', '12'],
    ['总额叁万陆仟元整', '叁万陆仟元整', '6000'],
    ['总价伍元陆角贰分', '伍元', '5'],
    ['总价三万6千元', '6千', '6000'],
    ['总价3万六千元', '3万', '30000'],
    ['总价一百二', '一百二', '102'],
    ['税额伍角', '伍', '5'],
    ['退费-十二万', '十二万', '120000'],
  ])(
    'rejects an unsupported value or partial token in %s',
    (text, quote, value) => {
      expect(isQuotedNumber(value, quote, text)).toBe(false);
    },
  );
});
