import type { RecordsService } from '../../records/records.service';
import {
  ACTOR_OVERRIDE_KEYS,
  admin,
  employee,
  recordToolFixture,
} from './record-read-tools.fixture';
import { createAggregateRecordsTool } from './aggregate-records.tool';

describe('aggregate_records', () => {
  it('requires objectCode and aggregation and rejects actor-override keys', () => {
    const tool = createAggregateRecordsTool({} as RecordsService, employee);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        aggregation: 'COUNT',
      }).success,
    ).toBe(true);
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        aggregation: 'COUNT',
        ...ACTOR_OVERRIDE_KEYS,
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        aggregation: 'COUNT',
        ownerMemberId: 'member-other',
      }).success,
    ).toBe(false);
  });

  it('caps limit at 20 and defaults it', () => {
    const tool = createAggregateRecordsTool({} as RecordsService, employee);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        aggregation: 'COUNT',
        limit: 21,
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.parse({ objectCode: 'leads', aggregation: 'COUNT' }),
    ).toMatchObject({ limit: 20 });
  });

  it('calls RecordsService.aggregate only', async () => {
    const aggregate = jest.fn().mockResolvedValue({
      value: '2',
      groups: [{ key: '待联系', value: '2', count: 2 }],
    });
    const list = jest.fn();
    const tool = createAggregateRecordsTool(
      { aggregate, list } as unknown as RecordsService,
      employee,
    );

    const result = await tool.execute(
      {
        objectCode: 'leads',
        aggregation: 'COUNT',
        groupByFieldKey: 'lead_status',
        filters: { lead_status: ['new'] },
        limit: 5,
      },
      'call-1',
    );

    expect(aggregate).toHaveBeenCalledWith(employee, 'leads', {
      aggregation: 'COUNT',
      groupByFieldKey: 'lead_status',
      filters: { lead_status: ['new'] },
      limit: 5,
    });
    expect(list).not.toHaveBeenCalled();
    expect(result).toEqual({
      value: '2',
      groups: [{ key: '待联系', value: '2', count: 2 }],
    });
  });

  it('rejects NONE read scope through the records service', async () => {
    const { records } = recordToolFixture({ readScope: 'NONE' });
    const tool = createAggregateRecordsTool(records, employee);

    await expect(
      tool.execute({ objectCode: 'leads', aggregation: 'COUNT' }, 'call-1'),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
  });

  it('does not expose hidden field names in validation failures', async () => {
    const { records } = recordToolFixture();
    const tool = createAggregateRecordsTool(records, admin);

    await expect(
      tool.execute(
        {
          objectCode: 'leads',
          aggregation: 'SUM',
          valueFieldKey: 'secret',
        },
        'call-1',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
