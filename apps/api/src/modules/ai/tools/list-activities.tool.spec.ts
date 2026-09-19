import type { RecordsService } from '../../records/records.service';
import {
  ACTOR_OVERRIDE_KEYS,
  employee,
  missingRecordId,
  otherRecordId,
  ownRecordId,
  recordToolFixture,
} from './record-read-tools.fixture';
import { createListActivitiesTool } from './list-activities.tool';

describe('list_activities', () => {
  it('requires objectCode and recordId and rejects actor-override keys', () => {
    const tool = createListActivitiesTool({} as RecordsService, employee);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        recordId: ownRecordId,
      }).success,
    ).toBe(true);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        recordId: ownRecordId,
        ...ACTOR_OVERRIDE_KEYS,
        ownerMemberId: 'member-other',
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        recordId: ownRecordId,
        limit: 21,
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.parse({
        objectCode: 'leads',
        recordId: ownRecordId,
      }),
    ).toMatchObject({ limit: 20 });
  });

  it('calls RecordsService.listActivities after schema parse', async () => {
    const page = {
      items: [
        {
          id: 'activity-own',
          activityType: 'NOTE',
          content: '自己的跟进',
          nextActionAt: null,
          actorMemberId: employee.memberId,
          actorDisplayName: '员工',
          createdAt: '2026-08-21T10:30:00.000Z',
        },
      ],
      page: 1,
      limit: 5,
      total: 1,
    };
    const listActivities = jest.fn().mockResolvedValue(page);
    const tool = createListActivitiesTool(
      { listActivities } as unknown as RecordsService,
      employee,
    );

    await expect(
      tool.execute(
        { objectCode: 'leads', recordId: ownRecordId, limit: 5 },
        'call-1',
      ),
    ).resolves.toEqual(page);
    expect(listActivities).toHaveBeenCalledWith(
      employee,
      'leads',
      ownRecordId,
      { page: 1, limit: 5 },
    );
  });

  it('returns activities for a visible record', async () => {
    const { records } = recordToolFixture();
    const tool = createListActivitiesTool(records, employee);

    const result = await tool.execute(
      { objectCode: 'leads', recordId: ownRecordId },
      'call-1',
    );

    expect(result).toMatchObject({
      total: 1,
      items: [{ content: '自己的跟进' }],
    });
    expect(JSON.stringify(result)).not.toMatch(/别人的跟进/);
  });

  it('preserves RECORD_NOT_FOUND for another owner or missing UUID', async () => {
    const { records } = recordToolFixture();
    const tool = createListActivitiesTool(records, employee);

    await expect(
      tool.execute({ objectCode: 'leads', recordId: otherRecordId }, 'call-1'),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(
      tool.execute({ objectCode: 'leads', recordId: missingRecordId }, 'call-1'),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('preserves OBJECT_ACTION_FORBIDDEN for NONE read scope', async () => {
    const { records } = recordToolFixture({ readScope: 'NONE' });
    const tool = createListActivitiesTool(records, employee);

    await expect(
      tool.execute({ objectCode: 'leads', recordId: ownRecordId }, 'call-1'),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
  });
});
