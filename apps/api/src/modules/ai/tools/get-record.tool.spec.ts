import type { RecordsService } from '../../records/records.service';
import {
  ACTOR_OVERRIDE_KEYS,
  employee,
  missingRecordId,
  otherRecordId,
  ownRecordId,
  recordToolFixture,
} from './record-read-tools.fixture';
import { createGetRecordTool } from './get-record.tool';

describe('get_record', () => {
  it('requires objectCode and recordId uuid and rejects actor-override keys', () => {
    const tool = createGetRecordTool({} as RecordsService, employee);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        recordId: ownRecordId,
      }).success,
    ).toBe(true);
    expect(tool.inputSchema.safeParse({ objectCode: 'leads' }).success).toBe(
      false,
    );
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        recordId: 'not-a-uuid',
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        recordId: ownRecordId,
        ...ACTOR_OVERRIDE_KEYS,
      }).success,
    ).toBe(false);
  });

  it('calls RecordsService.detail with the injected actor', async () => {
    const projected = {
      id: ownRecordId,
      recordNo: '1',
      ownerMemberId: employee.memberId,
      title: '自己的线索',
      values: { name: '自己的线索' },
      version: 1,
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    };
    const detail = jest.fn().mockResolvedValue(projected);
    const tool = createGetRecordTool(
      { detail } as unknown as RecordsService,
      employee,
    );

    await expect(
      tool.execute({ objectCode: 'leads', recordId: ownRecordId }, 'call-1'),
    ).resolves.toEqual(projected);
    expect(detail).toHaveBeenCalledWith(employee, 'leads', ownRecordId);
  });

  it('returns a visible OWN record without HIDDEN values', async () => {
    const { records } = recordToolFixture();
    const tool = createGetRecordTool(records, employee);

    const result = await tool.execute(
      { objectCode: 'leads', recordId: ownRecordId },
      'call-1',
    );

    expect(result).toMatchObject({
      id: ownRecordId,
      title: '自己的线索',
      values: { name: '自己的线索' },
    });
    expect(JSON.stringify(result)).not.toMatch(/仅管理员可见|secret/);
  });

  it('preserves RECORD_NOT_FOUND for another owner UUID and a missing UUID', async () => {
    const { records } = recordToolFixture();
    const tool = createGetRecordTool(records, employee);

    await expect(
      tool.execute({ objectCode: 'leads', recordId: otherRecordId }, 'call-1'),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(
      tool.execute({ objectCode: 'leads', recordId: missingRecordId }, 'call-1'),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('preserves OBJECT_ACTION_FORBIDDEN for NONE read scope', async () => {
    const { records } = recordToolFixture({ readScope: 'NONE' });
    const tool = createGetRecordTool(records, employee);

    await expect(
      tool.execute({ objectCode: 'leads', recordId: ownRecordId }, 'call-1'),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
  });
});
