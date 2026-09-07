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
      formatExportValue(
        { ...field, type: 'BOOLEAN' },
        true,
        new Map(),
      ),
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
});
