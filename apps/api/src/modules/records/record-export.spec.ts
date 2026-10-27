import {
  buildRecordExportCsv,
  exportFileName,
  formatExportValue,
} from './record-export';

describe('record export CSV', () => {
  it('quotes commas and prefixes a UTF-8 BOM so Excel keeps Chinese headers', () => {
    const csv = buildRecordExportCsv({
      fields: [
        {
          fieldKey: 'name',
          label: '姓名',
          type: 'TEXT',
          config: {},
        },
        {
          fieldKey: 'note',
          label: '备注',
          type: 'TEXTAREA',
          config: {},
        },
      ],
      records: [
        {
          recordNo: '12',
          ownerMemberId: 'member-1',
          values: { name: '张三', note: '需要期刊,尽快' },
          createdAt: '2026-08-21T10:00:00.000Z',
          updatedAt: '2026-08-21T11:30:00.000Z',
        },
      ],
      memberNames: new Map([['member-1', '林晨']]),
    });

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"需要期刊,尽快"');
    expect(csv).toContain('林晨');
  });

  it('renders option, member and boolean values as readable labels', () => {
    const field = {
      fieldKey: 'status',
      label: '状态',
      type: 'SINGLE_SELECT',
      config: { options: [{ key: 'new', label: '待联系' }] },
    };
    expect(formatExportValue(field, 'new', new Map())).toBe('待联系');
    expect(
      formatExportValue({ ...field, type: 'BOOLEAN' }, true, new Map()),
    ).toBe('是');
    expect(
      formatExportValue(
        { ...field, type: 'MEMBER' },
        'member-1',
        new Map([['member-1', '林晨']]),
      ),
    ).toBe('林晨');
  });

  it('strips characters that would break a download file name', () => {
    expect(exportFileName('销售/线索', 'leads')).toBe('销售_线索.csv');
  });

  it.each(['TEXT', 'TEXTAREA', 'SINGLE_SELECT', 'DATETIME'])(
    'preserves unexpected JSON objects in %s exports instead of [object Object]',
    (type) => {
      const value = { label: '旧数据,待核对', code: 'legacy' };
      expect(
        formatExportValue(
          { fieldKey: 'value', label: '内容', type, config: {} },
          value,
          new Map(),
        ),
      ).toBe(JSON.stringify(value));
    },
  );

  it('preserves unexpected option values alongside valid multi-select labels', () => {
    expect(
      formatExportValue(
        {
          fieldKey: 'status',
          label: '状态',
          type: 'MULTI_SELECT',
          config: { options: [{ key: 'new', label: '待联系' }] },
        },
        ['new', { label: '旧选项' }],
        new Map(),
      ),
    ).toBe('待联系；{"label":"旧选项"}');
  });

  it.each<[string, unknown, string]>([
    ['TEXT', '张三', '张三'],
    ['NUMBER', 0, '0'],
    ['NUMBER', 123.45, '123.45'],
    ['BOOLEAN', false, '否'],
    ['DATETIME', '2026-10-27T08:30:00.000Z', '2026-10-27 08:30'],
    ['TEXT', null, ''],
    ['TEXT', undefined, ''],
    ['TEXT', '', ''],
  ])('keeps %s value %s readable', (type, value, expected) => {
    expect(
      formatExportValue(
        { fieldKey: 'value', label: '内容', type, config: {} },
        value,
        new Map(),
      ),
    ).toBe(expected);
  });

  it('escapes preserved JSON content as a single CSV cell', () => {
    const csv = buildRecordExportCsv({
      fields: [
        { fieldKey: 'note', label: '备注', type: 'TEXTAREA', config: {} },
      ],
      records: [
        {
          recordNo: '1',
          ownerMemberId: null,
          values: { note: { label: '旧数据,待核对' } },
          createdAt: '',
          updatedAt: '',
        },
      ],
      memberNames: new Map(),
    });
    expect(csv).toContain('1,未指定,"{""label"":""旧数据,待核对""}",,\r\n');
    expect(csv).not.toContain('[object Object]');
  });
});

it.each(['=1+1', '+cmd', '-cmd', '@SUM(A1)', '\t=1', '  =1'])(
  'neutralizes spreadsheet formula %s',
  (value) => {
    const csv = buildRecordExportCsv({
      fields: [{ fieldKey: 'name', label: value, type: 'TEXT', config: {} }],
      records: [
        {
          recordNo: '1',
          ownerMemberId: 'm',
          values: { name: value },
          createdAt: '',
          updatedAt: '',
        },
      ],
      memberNames: new Map([['m', value]]),
    });
    expect(csv.split("'" + value)).toHaveLength(4);
  },
);
