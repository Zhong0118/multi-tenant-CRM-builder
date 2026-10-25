import request from 'supertest';

import type { TenantContext } from '../src/common/tenancy/tenant-context';
import type { DashboardQueryPlan } from '../src/modules/dashboards/dashboard-engine';
import { PrismaDashboardQueryExecutor } from '../src/modules/dashboards/dashboards.repository';
import { PublishedObjectService } from '../src/modules/objects/published-object.service';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

jest.setTimeout(180_000);

describe('Dashboard leaderboard historical member names', () => {
  let harness: CriticalHarness;
  let fixture: CriticalFixture;
  let context: TenantContext;
  let executor: PrismaDashboardQueryExecutor;

  beforeAll(async () => {
    harness = await createCriticalHarness();
    executor = harness.app.get(PrismaDashboardQueryExecutor);
  });

  beforeEach(async () => {
    fixture = await provisionCriticalFixture(harness);
    context = {
      userId: fixture.admin.userId,
      tenantId: fixture.tenantA.id,
      tenantCode: fixture.tenantA.code,
      memberId: fixture.admin.memberId,
      role: 'TENANT_ADMIN',
    };

    await harness.adminDatabase.tenantMember.update({
      where: { id: fixture.otherEmployee.memberId },
      data: { displayName: '历史销售成员' },
    });
    for (const [recordId, memberId] of [
      [fixture.ownedRecord.id, fixture.employee.memberId],
      [fixture.workflowRecord.id, fixture.employee.memberId],
      [fixture.otherRecord.id, fixture.otherEmployee.memberId],
    ]) {
      await harness.adminDatabase.record.update({
        where: { id: recordId },
        data: { data: { name: '历史业绩', credited_member: memberId } },
      });
    }
    await harness.adminDatabase.record.createMany({
      data: [
        {
          tenantId: fixture.tenantA.id,
          objectId: fixture.object.id,
          recordNo: BigInt(4),
          ownerMemberId: fixture.admin.memberId,
          title: '活跃成员业绩',
          data: {
            name: '活跃成员业绩',
            credited_member: fixture.admin.memberId,
          },
        },
        {
          tenantId: fixture.tenantA.id,
          objectId: fixture.object.id,
          recordNo: BigInt(5),
          ownerMemberId: null,
          title: '无负责人',
          data: { name: '无负责人' },
        },
        {
          tenantId: fixture.tenantA.id,
          objectId: fixture.object.id,
          recordNo: BigInt(6),
          ownerMemberId: null,
          title: '空负责人',
          data: { name: '空负责人', credited_member: null },
        },
      ],
    });
  });

  afterAll(async () => {
    if (harness) await closeCriticalHarness(harness);
  });

  it.each(['RECORD_OWNER', 'FIELD'] as const)(
    'preserves historical names and totals for %s after members are disabled',
    async (memberSource) => {
      const plan = await leaderboardPlan(memberSource);
      const expectedItems = [
        {
          memberId: fixture.employee.memberId,
          displayName: 'Critical Employee',
          value: 2,
        },
        {
          memberId: fixture.admin.memberId,
          displayName: 'Critical Admin',
          value: 1,
        },
        {
          memberId: fixture.otherEmployee.memberId,
          displayName: '历史销售成员',
          value: 1,
        },
      ];

      const before = await executor.execute(context, [plan]);
      expect(before.get(plan.widget.id)).toMatchObject({
        type: 'LEADERBOARD',
        state: 'READY',
        data: { items: expectedItems },
      });

      await harness.adminDatabase.tenantMember.updateMany({
        where: {
          tenantId: fixture.tenantA.id,
          id: {
            in: [fixture.employee.memberId, fixture.otherEmployee.memberId],
          },
        },
        data: { status: 'DISABLED' },
      });

      const after = await executor.execute(context, [plan]);
      expect(after.get(plan.widget.id)).toMatchObject({
        type: 'LEADERBOARD',
        state: 'READY',
        data: { items: expectedItems },
      });
    },
  );

  it.each(['ACTIVE', 'DISABLED'] as const)(
    'does not expose another tenant member name for a forged FIELD value (%s)',
    async (status) => {
      await harness.adminDatabase.tenantMember.update({
        where: { id: fixture.tenantBAdmin.memberId },
        data: { status, displayName: '另一租户私有姓名' },
      });
      await harness.adminDatabase.record.update({
        where: { id: fixture.ownedRecord.id },
        data: {
          data: {
            name: '伪造归属',
            credited_member: fixture.tenantBAdmin.memberId,
          },
        },
      });

      const plan = await leaderboardPlan('FIELD');
      const result = await executor.execute(context, [plan]);

      const leaderboard = result.get(plan.widget.id);
      expect(leaderboard).toMatchObject({
        type: 'LEADERBOARD',
        state: 'READY',
      });
      if (
        leaderboard?.type !== 'LEADERBOARD' ||
        leaderboard.state !== 'READY'
      ) {
        throw new Error('Leaderboard query did not return rows');
      }
      expect(leaderboard.data.items).toContainEqual({
        memberId: fixture.tenantBAdmin.memberId,
        displayName: fixture.tenantBAdmin.memberId,
        value: 1,
      });
      expect(leaderboard.data.items).toHaveLength(4);
      expect(JSON.stringify([...result.values()])).not.toContain(
        '另一租户私有姓名',
      );
      expect(JSON.stringify([...result.values()])).not.toContain(
        'Critical Tenant B Admin',
      );
    },
  );

  it('keeps disabled members denied access to workspace dashboards', async () => {
    await harness.adminDatabase.tenantMember.update({
      where: { id: fixture.employee.memberId },
      data: { status: 'DISABLED' },
    });

    await request(harness.app.getHttpServer())
      .get(`/api/v1/workspaces/${fixture.tenantA.code}/dashboards/overview`)
      .set('Cookie', fixture.employee.cookie)
      .expect(403);
  });

  async function leaderboardPlan(
    memberSource: 'RECORD_OWNER' | 'FIELD',
  ): Promise<DashboardQueryPlan> {
    const { schema } = await harness.app
      .get(PublishedObjectService)
      .resolveRuntimeSchema(context, fixture.object.code);

    return {
      object: schema,
      period: {
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
        timezone: 'Asia/Shanghai',
      },
      visibleFieldKeys: ['name', 'credited_member'],
      canReadTitle: true,
      widget: {
        id: 'historical-leaderboard',
        type: 'LEADERBOARD',
        title: '历史业绩',
        audience: 'ALL',
        objectCode: fixture.object.code,
        width: 'HALF',
        sortOrder: 0,
        filters: [],
        memberSource,
        ...(memberSource === 'FIELD'
          ? {
              memberFieldKey: 'credited_member',
              memberField: {
                fieldKey: 'credited_member',
                label: '业绩成员',
                type: 'MEMBER' as const,
              },
            }
          : {}),
        aggregation: 'COUNT',
        limit: 10,
        objectPublicationId: schema.publication.id,
        objectPublicationNumber: schema.publication.number,
        objectName: schema.object.name,
        filterFields: [],
      },
    };
  }
});
