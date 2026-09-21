import { AiSourceBuilder } from './ai-source-builder';

describe('AiSourceBuilder.fromTool', () => {
  it('builds a RECORDS source without embedding raw record values', () => {
    const source = AiSourceBuilder.fromTool({
      toolName: 'search_records',
      input: { objectCode: 'leads', limit: 20 },
      result: {
        items: [
          {
            id: 'rec-1',
            title: '自己的线索',
            values: { name: '自己的线索', secret: '内部备注' },
          },
        ],
        total: 1,
      },
    });
    expect(source).toEqual({
      kind: 'RECORDS',
      objectCode: 'leads',
      objectName: 'leads',
      count: 1,
    });
    expect(JSON.stringify(source)).not.toContain('内部备注');
    expect(JSON.stringify(source)).not.toContain('values');
  });

  it('builds an AGGREGATE source from the numeric summary only', () => {
    const source = AiSourceBuilder.fromTool({
      toolName: 'aggregate_records',
      input: { objectCode: 'opportunities', aggregation: 'SUM' },
      result: { value: '320000', groups: [] },
    });
    expect(source).toEqual({
      kind: 'AGGREGATE',
      objectCode: 'opportunities',
      objectName: 'opportunities',
      label: '合计',
      value: '320000',
    });
  });

  it('prefers published objectName from the sanitized result over objectCode', () => {
    const source = AiSourceBuilder.fromTool({
      toolName: 'search_records',
      input: { objectCode: 'leads', limit: 20 },
      result: {
        objectName: '线索',
        items: [{ id: 'rec-1', title: '自己的线索' }],
        total: 1,
      },
    });
    expect(source).toEqual({
      kind: 'RECORDS',
      objectCode: 'leads',
      objectName: '线索',
      count: 1,
    });
    expect(JSON.stringify(source)).not.toContain('销售线索');
  });

  it('falls back to a generic kind label when no published name is present', () => {
    expect(
      AiSourceBuilder.fromTool({
        toolName: 'list_followups',
        input: { limit: 20 },
        result: [{ id: 'f1' }],
      }),
    ).toEqual({
      kind: 'TIMELINE',
      objectCode: 'followups',
      objectName: '跟进',
      count: 1,
    });
    expect(
      AiSourceBuilder.fromTool({
        toolName: 'list_activities',
        input: { recordId: '0198ad18-a74d-7b69-b81a-49a74f9a3e01' },
        result: { items: [{ id: 'a1' }], total: 1 },
      }),
    ).toEqual({
      kind: 'TIMELINE',
      objectCode: 'records',
      objectName: '活动',
      recordId: '0198ad18-a74d-7b69-b81a-49a74f9a3e01',
      count: 1,
    });
  });

  it('builds a TIMELINE source for activities and follow-ups', () => {
    expect(
      AiSourceBuilder.fromTool({
        toolName: 'list_activities',
        input: { objectCode: 'leads', recordId: '0198ad18-a74d-7b69-b81a-49a74f9a3e01' },
        result: { items: [{ id: 'a1' }, { id: 'a2' }], total: 2 },
      }),
    ).toEqual({
      kind: 'TIMELINE',
      objectCode: 'leads',
      objectName: 'leads',
      recordId: '0198ad18-a74d-7b69-b81a-49a74f9a3e01',
      count: 2,
    });
    expect(
      AiSourceBuilder.fromTool({
        toolName: 'list_followups',
        input: { objectCode: 'leads', limit: 20 },
        result: [{ id: 'f1', objectCode: 'leads', objectName: '线索', recordId: 'r1' }],
      }),
    ).toEqual({
      kind: 'TIMELINE',
      objectCode: 'leads',
      objectName: '线索',
      count: 1,
    });
  });
});
