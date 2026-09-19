import type { RecordsService } from '../../records/records.service';
import {
  ACTOR_OVERRIDE_KEYS,
  admin,
  employee,
  otherRecordId,
  ownRecordId,
  recordToolFixture,
} from './record-read-tools.fixture';
import { createSearchRecordsTool } from './search-records.tool';

describe('search_records', () => {
  it('requires objectCode and rejects actor-override and owner keys', () => {
    const tool = createSearchRecordsTool({} as RecordsService, employee);
    expect(tool.inputSchema.safeParse({ objectCode: 'leads' }).success).toBe(true);
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        ...ACTOR_OVERRIDE_KEYS,
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        ownerMemberId: 'member-other',
      }).success,
    ).toBe(false);
  });

  it('caps limit at 20 and defaults sort, direction, and limit', () => {
    const tool = createSearchRecordsTool({} as RecordsService, employee);
    expect(
      tool.inputSchema.safeParse({ objectCode: 'leads', limit: 21 }).success,
    ).toBe(false);
    expect(tool.inputSchema.parse({ objectCode: 'leads' })).toMatchObject({
      sort: 'updatedAt',
      direction: 'desc',
      limit: 10,
    });
  });

  it('calls RecordsService.list without ownerMemberId and returns projected rows', async () => {
    const list = jest.fn().mockResolvedValue({
      items: [
        {
          id: ownRecordId,
          recordNo: '1',
          ownerMemberId: employee.memberId,
          title: '自己的线索',
          values: { name: '自己的线索' },
          version: 1,
          createdAt: '2026-08-21T10:00:00.000Z',
          updatedAt: '2026-08-21T10:00:00.000Z',
        },
      ],
      page: 1,
      limit: 5,
      total: 1,
    });
    const tool = createSearchRecordsTool(
      { list } as unknown as RecordsService,
      employee,
    );

    const result = await tool.execute(
      {
        objectCode: 'leads',
        query: '自己',
        filters: { lead_status: ['new'] },
        sort: 'recordNo',
        direction: 'asc',
        limit: 5,
      },
      'call-1',
    );

    expect(list).toHaveBeenCalledWith(employee, 'leads', {
      page: 1,
      limit: 5,
      search: '自己',
      filters: JSON.stringify({ lead_status: ['new'] }),
      sort: 'recordNo',
      direction: 'asc',
    });
    expect(list.mock.calls[0][2]).not.toHaveProperty('ownerMemberId');
    expect(result).toEqual({
      items: [
        {
          id: ownRecordId,
          recordNo: '1',
          ownerMemberId: employee.memberId,
          title: '自己的线索',
          values: { name: '自己的线索' },
          version: 1,
          createdAt: '2026-08-21T10:00:00.000Z',
          updatedAt: '2026-08-21T10:00:00.000Z',
        },
      ],
      page: 1,
      limit: 5,
      total: 1,
    });
  });

  it('returns only OWN records and never exposes HIDDEN values', async () => {
    const { records } = recordToolFixture();
    const tool = createSearchRecordsTool(records, employee);

    const result = await tool.execute({ objectCode: 'leads' }, 'call-1');

    expect(result).toMatchObject({
      total: 1,
      items: [{ id: ownRecordId, title: '自己的线索' }],
    });
    expect(JSON.stringify(result)).not.toMatch(/仅管理员可见|别人的线索|secret/);
  });

  it('returns ALL visible records for an admin without HIDDEN stripping for admin', async () => {
    const { records } = recordToolFixture();
    const tool = createSearchRecordsTool(records, admin);

    const result = await tool.execute({ objectCode: 'leads', limit: 20 }, 'call-1');

    expect(result).toMatchObject({ total: 2 });
    expect((result as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual(
      expect.arrayContaining([ownRecordId, otherRecordId]),
    );
  });

  it('rejects NONE read scope', async () => {
    const { records } = recordToolFixture({ readScope: 'NONE' });
    const tool = createSearchRecordsTool(records, employee);

    await expect(tool.execute({ objectCode: 'leads' }, 'call-1')).rejects.toMatchObject({
      code: 'OBJECT_ACTION_FORBIDDEN',
    });
  });
});
