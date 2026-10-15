import type { PublishedObjectSchema } from '../../objects/object-schema';
import { defaultAiToolCallbacks, wrapAiReadTool } from '../ai-tool-wrapper';
import type { RecordsService } from '../../records/records.service';
import {
  ACTOR_OVERRIDE_KEYS,
  admin,
  employee,
  recordToolFixture,
} from './record-read-tools.fixture';
import { createAggregateRecordsTool } from './aggregate-records.tool';

describe('aggregate_records', () => {
  it('lets a model correct a scalar option filter without weakening actual service validation', async () => {
    const { records, store, publishedRepository } = recordToolFixture();
    const schema = publishedRepository.record
      .configuration as PublishedObjectSchema;
    schema.fields.push(
      {
        ...schema.fields[0]!,
        id: 'stage',
        fieldKey: 'stage',
        label: '阶段',
        type: 'SINGLE_SELECT',
        config: { options: [{ key: 'lost', label: '已流失' }] },
      },
      {
        ...schema.fields[0]!,
        id: 'amount',
        fieldKey: 'amount',
        label: '预计金额',
        type: 'MONEY',
      },
    );
    schema.employeeAccess.fields.stage = 'READ_ONLY';
    schema.employeeAccess.fields.amount = 'READ_ONLY';
    store.records[0]!.values = { name: 'A', stage: 'lost', amount: 150000 };
    store.records[1]!.values = { name: 'B', stage: 'lost', amount: 105000 };
    const aggregateRecords = jest.fn(async () => ({
      value: String(
        store.records.reduce((sum, row) => sum + Number(row.values.amount), 0),
      ),
      groups: [],
    }));
    Object.assign(store, { aggregateRecords });
    const cb = defaultAiToolCallbacks();
    const tool = wrapAiReadTool(createAggregateRecordsTool(records, admin), cb);
    const query = {
      objectCode: 'leads',
      aggregation: 'SUM',
      valueFieldKey: 'amount',
    };
    await expect(
      tool.execute({ ...query, filters: { stage: 'lost' } }, 'bad'),
    ).resolves.toMatchObject({ code: 'INVALID_TOOL_ARGUMENT' });
    expect(aggregateRecords).not.toHaveBeenCalled();
    await expect(
      tool.execute({ ...query, filters: { stage: ['lost'] } }, 'fixed'),
    ).resolves.toEqual({ value: '255000', groups: [] });
    expect(aggregateRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ fieldKey: 'stage', mode: 'EQUALS', values: ['lost'] }],
        valueFieldKey: 'amount',
      }),
    );
    await expect(
      tool.execute(
        { ...query, filters: { stage: ['not-visible-option'] } },
        'invalid-option',
      ),
    ).resolves.toMatchObject({ code: 'INVALID_TOOL_ARGUMENT' });
    expect(aggregateRecords).toHaveBeenCalledTimes(1);
    expect(cb.toolSummaries.map((item) => item.status)).toEqual([
      'FAILED',
      'COMPLETED',
      'FAILED',
    ]);
  });

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
