import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type {
  CreateMemberGroupDto,
  MemberGroupDto,
  MemberGroupListDto,
} from '../src/modules/memberships/dto/member-groups.dto';
import { MemberGroupsService } from '../src/modules/memberships/member-groups.service';
import { lockRuntimeObjectConfiguration } from '../src/modules/objects/object-configuration-lock';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

const json = <T>(response: { body: unknown }) => response.body as T;
jest.setTimeout(120_000);

describe('member groups (HTTP + PostgreSQL)', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}/member-groups`;
  const get = (actor: CriticalActor = f.admin) =>
    request(h.app.getHttpServer()).get(base()).set('Cookie', actor.cookie);
  const write = (
    method: 'post' | 'patch' | 'delete',
    path: string,
    body: object,
    actor: CriticalActor = f.admin,
  ) =>
    request(h.app.getHttpServer())
      [method](base() + path)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000')
      .send(body);
  const input = () => ({
    name: '销售一组',
    leaderMemberId: f.employee.memberId,
    memberIds: [f.employee.memberId, f.otherEmployee.memberId],
  });
  const create = async (body: CreateMemberGroupDto = input()) =>
    json<MemberGroupDto>(await write('post', '', body).expect(201));

  beforeAll(async () => {
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
  });
  afterEach(async () => {
    if (!f) return;
    const tenantId = { in: [f.tenantA.id, f.tenantB.id] };
    await h.adminDatabase.memberGroup.updateMany({
      where: { tenantId },
      data: { leaderMemberId: null },
    });
    await h.adminDatabase.tenantMember.updateMany({
      where: { tenantId },
      data: { groupId: null },
    });
    await h.adminDatabase.memberGroup.deleteMany({ where: { tenantId } });
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });

  it('creates a group with current members, trims its name and records an audit', async () => {
    const before = json<MemberGroupListDto>(await get().expect(200));
    expect(before.items).toEqual([]);
    expect(before.members.map((member) => member.id).sort()).toEqual(
      [f.admin.memberId, f.employee.memberId, f.otherEmployee.memberId].sort(),
    );
    const created = await create({ ...input(), name: '  销售一组  ' });
    expect(created).toMatchObject({
      name: '销售一组',
      version: 1,
      leaderMemberId: f.employee.memberId,
    });
    expect(created.memberIds.sort()).toEqual(input().memberIds.sort());
    const listed = json<MemberGroupListDto>(await get().expect(200));
    expect(listed.items).toEqual([created]);
    expect(
      listed.members
        .filter((member) => member.groupId === created.id)
        .map((member) => member.id)
        .sort(),
    ).toEqual(input().memberIds.sort());
    expect(
      await h.adminDatabase.auditLog.count({
        where: { tenantId: f.tenantA.id, action: 'member_group.created' },
      }),
    ).toBe(1);
  });

  it('allows an empty group and rejects unauthorized or cross-tenant access', async () => {
    const created = await create({
      name: '待编组',
      leaderMemberId: null,
      memberIds: [],
    });
    expect(created.memberIds).toEqual([]);
    await get(f.employee).expect(403);
    await write('post', '', input(), f.employee).expect(403);
    await write(
      'patch',
      `/${created.id}`,
      { ...input(), expectedVersion: 1 },
      f.employee,
    ).expect(403);
    await write(
      'delete',
      `/${created.id}`,
      { expectedVersion: 1 },
      f.employee,
    ).expect(403);
    await get(f.tenantBAdmin).expect(403);
    await write('post', '', {
      ...input(),
      memberIds: [f.tenantBAdmin.memberId],
      leaderMemberId: f.tenantBAdmin.memberId,
    }).expect(400);
    await write('patch', `/${randomUUID()}`, {
      ...input(),
      expectedVersion: 1,
    }).expect(404);
    await write('delete', `/${randomUUID()}`, { expectedVersion: 1 }).expect(
      404,
    );
    await write('patch', '/invalid-id', {
      ...input(),
      expectedVersion: 1,
    }).expect(400);
  });

  it('another company cannot read or mutate this company group through its own workspace', async () => {
    const created = await create();
    const otherBase = `/api/v1/workspaces/${f.tenantB.code}/member-groups`;
    const listed = await request(h.app.getHttpServer())
      .get(otherBase)
      .set('Cookie', f.tenantBAdmin.cookie)
      .expect(200);
    expect(json<MemberGroupListDto>(listed).items).toEqual([]);
    for (const method of ['patch', 'delete'] as const) {
      await request(h.app.getHttpServer())
        [method](`${otherBase}/${created.id}`)
        .set('Cookie', f.tenantBAdmin.cookie)
        .set('Origin', 'http://localhost:3000')
        .send(
          method === 'delete'
            ? { expectedVersion: 1 }
            : { ...input(), expectedVersion: 1 },
        )
        .expect(404);
    }
    expect(json<MemberGroupListDto>(await get().expect(200)).items).toEqual([
      created,
    ]);
  });

  it('promoting a leader to company admin removes their group role and invalidates stale edits', async () => {
    const created = await create();
    await request(h.app.getHttpServer())
      .patch(
        `/api/v1/workspaces/${f.tenantA.code}/members/${f.employee.memberId}/role`,
      )
      .set('Cookie', f.admin.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ role: 'TENANT_ADMIN' })
      .expect(200);
    const group = json<MemberGroupListDto>(await get().expect(200)).items[0];
    expect(group).toEqual({
      ...created,
      leaderMemberId: null,
      memberIds: [f.otherEmployee.memberId],
      version: 2,
    });
    await write('patch', `/${created.id}`, {
      ...input(),
      expectedVersion: 1,
    }).expect(409);
    const member = await h.adminDatabase.tenantMember.findUniqueOrThrow({
      where: { id: f.employee.memberId },
    });
    expect(member.groupId).toBeNull();
  });

  it.each(['group change', 'leader promotion'] as const)(
    '%s waits for an active runtime scope before changing group membership',
    async (operation) => {
      const created = await create();
      let ready!: () => void;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const unlocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = h.adminDatabase.$transaction(
        async (tx) => {
          await lockRuntimeObjectConfiguration(tx, f.tenantA.id);
          ready();
          await unlocked;
        },
        { timeout: 10000 },
      );
      await held;
      let completed = false;
      const mutation =
        operation === 'group change'
          ? write('patch', `/${created.id}`, {
              ...input(),
              expectedVersion: 1,
              memberIds: [f.employee.memberId],
            })
          : request(h.app.getHttpServer())
              .patch(
                `/api/v1/workspaces/${f.tenantA.code}/members/${f.employee.memberId}/role`,
              )
              .set('Cookie', f.admin.cookie)
              .set('Origin', 'http://localhost:3000')
              .send({ role: 'TENANT_ADMIN' });
      const pending = mutation.then((response) => {
        completed = true;
        return response;
      });
      try {
        let blocked = false;
        const deadline = Date.now() + 2000;
        while (!blocked && !completed && Date.now() < deadline) {
          const rows = await h.adminDatabase.$queryRaw<
            Array<{ count: number }>
          >`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname=current_database() AND usename='crm_app'
              AND wait_event='advisory' AND query ILIKE '%object-configuration%'
          `;
          blocked = rows[0].count > 0;
          if (!blocked && !completed)
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        expect(completed).toBe(false);
        expect(
          await h.adminDatabase.memberGroup.findUniqueOrThrow({
            where: { id: created.id },
          }),
        ).toMatchObject({ version: 1, leaderMemberId: f.employee.memberId });
        expect(
          await h.adminDatabase.tenantMember.findUniqueOrThrow({
            where: { id: f.otherEmployee.memberId },
          }),
        ).toMatchObject({ groupId: created.id });
      } finally {
        release();
        await holding;
        await pending;
      }
      expect((await pending).status).toBe(200);
    },
  );

  it('validates names, duplicate ids, group leaders and mutation versions', async () => {
    for (const patch of [
      { name: '' },
      { name: '   ' },
      { name: '组'.repeat(101) },
      { memberIds: [f.employee.memberId, f.employee.memberId] },
      { memberIds: [f.admin.memberId], leaderMemberId: f.admin.memberId },
      { memberIds: [f.otherEmployee.memberId] },
      { leaderMemberId: 'invalid-id' },
      { memberIds: [randomUUID()] },
    ])
      await write('post', '', { ...input(), ...patch }).expect(400);
    const created = await create();
    await write('patch', `/${created.id}`, input()).expect(400);
    await write('patch', `/${created.id}`, {
      ...input(),
      expectedVersion: null,
    }).expect(400);
    await write('delete', `/${created.id}`, {}).expect(400);
    await write('delete', `/${created.id}`, { expectedVersion: -1 }).expect(
      400,
    );
    await write('patch', `/${created.id}`, {
      ...input(),
      expectedVersion: 0,
    }).expect(400);
    await write('delete', `/${created.id}`, { expectedVersion: 2 }).expect(409);
    expect(
      json<MemberGroupListDto>(await get().expect(200)).items,
    ).toHaveLength(1);
  });

  it('serializes concurrent creation and optimistic group edits', async () => {
    const requests = await Promise.all([
      write('post', '', input()),
      write('post', '', input()),
    ]);
    expect(requests.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const created = json<MemberGroupDto>(
      requests.find((response) => response.status === 201)!,
    );
    const updates = await Promise.all([
      write('patch', `/${created.id}`, {
        ...input(),
        expectedVersion: 1,
        name: '销售甲组',
      }),
      write('patch', `/${created.id}`, {
        ...input(),
        expectedVersion: 1,
        name: '销售乙组',
      }),
    ]);
    expect(updates.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      json<MemberGroupListDto>(await get().expect(200)).items[0].version,
    ).toBe(2);
  });

  it('moving an employee invalidates the source group version without changing any records', async () => {
    const source = await create();
    const ownersBefore = await h.adminDatabase.record.findMany({
      where: { tenantId: f.tenantA.id },
      select: { id: true, ownerMemberId: true },
      orderBy: { id: 'asc' },
    });
    const target = await create({
      name: '销售二组',
      leaderMemberId: null,
      memberIds: [f.otherEmployee.memberId],
    });
    const groups = json<MemberGroupListDto>(await get().expect(200)).items;
    expect(groups.find((group) => group.id === source.id)).toMatchObject({
      version: 2,
      memberIds: [f.employee.memberId],
    });
    expect(target.memberIds).toEqual([f.otherEmployee.memberId]);
    await write('patch', `/${source.id}`, {
      ...input(),
      expectedVersion: 1,
    }).expect(409);
    expect(
      await h.adminDatabase.record.findMany({
        where: { tenantId: f.tenantA.id },
        select: { id: true, ownerMemberId: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(ownersBefore);
  });

  it('requires replacing another group leader before moving them and keeps failures atomic', async () => {
    const source = await create();
    await write('post', '', {
      name: '销售二组',
      leaderMemberId: f.employee.memberId,
      memberIds: [f.employee.memberId],
    }).expect(409);
    expect(json<MemberGroupListDto>(await get().expect(200)).items).toEqual([
      source,
    ]);
    await write('patch', `/${source.id}`, {
      ...input(),
      leaderMemberId: f.otherEmployee.memberId,
      expectedVersion: 1,
    }).expect(200);
    const target = await create({
      name: '销售二组',
      leaderMemberId: f.employee.memberId,
      memberIds: [f.employee.memberId],
    });
    expect(target.leaderMemberId).toBe(f.employee.memberId);
  });

  it.each(['member', 'account'] as const)(
    'preserves existing disabled %s members but rejects new assignments or disabled leaders',
    async (disabled) => {
      const created = await create();
      if (disabled === 'member') {
        await h.adminDatabase.tenantMember.update({
          where: { id: f.otherEmployee.memberId },
          data: { status: 'DISABLED' },
        });
      } else {
        await h.adminDatabase.user.update({
          where: { id: f.otherEmployee.userId },
          data: { status: 'DISABLED' },
        });
      }
      const kept = json<MemberGroupDto>(
        await write('patch', `/${created.id}`, {
          ...input(),
          expectedVersion: 1,
          name: '销售甲组',
        }).expect(200),
      );
      expect(kept.memberIds.sort()).toEqual(input().memberIds.sort());
      await write('patch', `/${created.id}`, {
        ...input(),
        expectedVersion: 2,
        leaderMemberId: f.otherEmployee.memberId,
      }).expect(400);
      await write('post', '', {
        name: '销售二组',
        leaderMemberId: null,
        memberIds: [f.otherEmployee.memberId],
      }).expect(400);
    },
  );

  it('revalidates a stale admin context inside the mutation transaction', async () => {
    await h.adminDatabase.tenantMember.update({
      where: { id: f.admin.memberId },
      data: { role: 'EMPLOYEE' },
    });
    await expect(
      h.app.get(MemberGroupsService).create(
        {
          userId: f.admin.userId,
          memberId: f.admin.memberId,
          tenantId: f.tenantA.id,
          tenantCode: f.tenantA.code,
          role: 'TENANT_ADMIN',
        },
        input(),
        { requestId: 'groups-stale-admin' },
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    expect(
      await h.adminDatabase.memberGroup.count({
        where: { tenantId: f.tenantA.id },
      }),
    ).toBe(0);
  });

  it('disbanding preserves accounts, record owners and permission overrides, and audits the change', async () => {
    const created = await create();
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.employee.memberId,
        canRead: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        readScope: 'GROUP',
        updateScope: 'NONE',
      },
    });
    const recordsBefore = await h.adminDatabase.record.findMany({
      where: { tenantId: f.tenantA.id },
      orderBy: { id: 'asc' },
    });
    expect(
      json<{ ok: boolean }>(
        await write('delete', `/${created.id}`, { expectedVersion: 1 }).expect(
          200,
        ),
      ),
    ).toEqual({ ok: true });
    expect(json<MemberGroupListDto>(await get().expect(200)).items).toEqual([]);
    expect(
      await h.adminDatabase.tenantMember.count({
        where: { tenantId: f.tenantA.id },
      }),
    ).toBe(3);
    expect(
      await h.adminDatabase.tenantMember.count({
        where: { tenantId: f.tenantA.id, groupId: { not: null } },
      }),
    ).toBe(0);
    expect(
      await h.adminDatabase.record.findMany({
        where: { tenantId: f.tenantA.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(recordsBefore);
    expect(
      await h.adminDatabase.objectPermission.count({
        where: { subjectMemberId: f.employee.memberId, readScope: 'GROUP' },
      }),
    ).toBe(1);
    expect(
      await h.adminDatabase.auditLog.count({
        where: { tenantId: f.tenantA.id, action: 'member_group.deleted' },
      }),
    ).toBe(1);
  });
  it('enforces tenant RLS, composite group membership keys and read-only GROUP at database level', async () => {
    const created = await create();
    expect(await h.runtimeDatabase.memberGroup.findMany()).toEqual([]);
    const foreignGroups = await h.runtimeDatabase.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${f.tenantB.id}, true)`;
      return tx.memberGroup.findMany({ where: { id: created.id } });
    });
    expect(foreignGroups).toEqual([]);
    await expect(
      h.adminDatabase.tenantMember.update({
        where: { id: f.tenantBAdmin.memberId },
        data: { groupId: created.id },
      }),
    ).rejects.toThrow();
    await expect(
      h.adminDatabase.memberGroup.create({
        data: {
          tenantId: f.tenantA.id,
          name: '跨公司组长',
          leaderMemberId: f.tenantBAdmin.memberId,
        },
      }),
    ).rejects.toThrow();
    const policy = {
      tenantId: f.tenantA.id,
      objectId: f.object.id,
      subjectType: 'MEMBER' as const,
      subjectMemberId: f.employee.memberId,
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'GROUP' as const,
      updateScope: 'GROUP' as const,
    };
    await expect(
      h.adminDatabase.objectPermission.create({ data: policy }),
    ).rejects.toThrow();
    await expect(
      h.adminDatabase.objectPermission.create({
        data: {
          ...policy,
          subjectType: 'ROLE',
          subjectRole: 'EMPLOYEE',
          subjectMemberId: null,
          updateScope: 'OWN',
        },
      }),
    ).rejects.toThrow();
    expect(
      await h.adminDatabase.tenantMember.findUnique({
        where: { id: f.tenantBAdmin.memberId },
        select: { groupId: true },
      }),
    ).toEqual({ groupId: null });
  });
});
