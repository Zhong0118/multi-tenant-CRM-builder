import request from 'supertest';
import { RecordsService } from '../src/modules/records/records.service';
import type { RecordPageResponseDto } from '../src/modules/records/dto';
import type {
  RecordViewListResponseDto,
  RecordViewResponseDto,
} from '../src/modules/views/dto';

function view(response: { body: unknown }) {
  return response.body as RecordViewResponseDto;
}

import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

const origin = 'http://localhost:3000';
const empty = { version: 1, match: 'all', conditions: [] };
jest.setTimeout(120_000);

describe('record views in the active workspace', () => {
  let harness: CriticalHarness;
  let fixture: CriticalFixture;
  let path: string;
  let records: string;
  beforeAll(async () => {
    harness = await createCriticalHarness();
    await harness.app.listen(0, '127.0.0.1');
    fixture = await provisionCriticalFixture(harness);
    const objectPath = `/api/v1/workspaces/${fixture.tenantA.code}/objects/${fixture.object.code}`;
    path = objectPath + '/record-views';
    records = objectPath + '/records';
  });
  afterAll(async () => {
    if (harness) await closeCriticalHarness(harness);
  });

  function post(cookie: string, body: object) {
    return request(harness.app.getHttpServer())
      .post(path)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send(body);
  }
  function get(cookie: string, url: string) {
    return request(harness.app.getHttpServer()).get(url).set('Cookie', cookie);
  }

  it('deduplicates concurrent imports for one member and isolates personal views from colleagues and admins', async () => {
    const body = {
      name: '本机客户',
      scope: 'PERSONAL',
      importKey: 'local-fingerprint-1',
      filterRule: empty,
      columnFieldKeys: ['name'],
      columnWidths: { name: 188 },
      sort: { field: 'recordNo', direction: 'asc' },
      queryOptions: { search: '线索' },
    };
    const [a, retry, other] = await Promise.all([
      post(fixture.employee.cookie, body).expect(201),
      post(fixture.employee.cookie, body).expect(201),
      post(fixture.otherEmployee.cookie, body).expect(201),
    ]);
    expect(view(a).id).toEqual(view(retry).id);
    expect(view(other).id).not.toEqual(view(a).id);
    const detail = await get(
      fixture.employee.cookie,
      `${path}/${view(a).id}`,
    ).expect(200);
    expect(detail.body).toMatchObject({
      available: true,
      canEdit: true,
      revision: 1,
      columnWidths: { name: 188 },
      queryOptions: { search: '线索' },
    });
    for (const cookie of [fixture.otherEmployee.cookie, fixture.admin.cookie]) {
      const list = await get(cookie, path).expect(200);
      expect(
        (list.body as RecordViewListResponseDto).items.map((item) => item.id),
      ).not.toContain(view(a).id);
      await get(cookie, `${path}/${view(a).id}`).expect(404);
      await get(cookie, `${records}?viewId=${view(a).id}`).expect(404);
    }
  });

  it('keeps only the winning concurrent edit, rejects stale archive, then hides the archived view', async () => {
    const created = await post(fixture.admin.cookie, {
      name: '团队',
      scope: 'SHARED',
    }).expect(201);
    const url = `${path}/${view(created).id}`;
    const patch = (cookie: string, name: string) =>
      request(harness.app.getHttpServer())
        .patch(url)
        .set('Origin', origin)
        .set('Cookie', cookie)
        .send({ name, expectedRevision: 1 });
    await patch(fixture.employee.cookie, '改名').expect(403);
    const changes = await Promise.all([
      patch(fixture.admin.cookie, '甲'),
      patch(fixture.admin.cookie, '乙'),
    ]);
    expect(changes.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const remove = (expectedRevision: number) =>
      request(harness.app.getHttpServer())
        .delete(url)
        .set('Origin', origin)
        .set('Cookie', fixture.admin.cookie)
        .send({ expectedRevision });
    await remove(1).expect(409);
    await remove(2).expect(204);
    await get(fixture.admin.cookie, url).expect(404);
  });

  it('archives a personal view through a plain DELETE request', async () => {
    const created = await post(fixture.employee.cookie, {
      name: '临时视图',
      scope: 'PERSONAL',
    }).expect(201);
    const url = `${path}/${view(created).id}`;
    await request(harness.app.getHttpServer())
      .delete(url)
      .set('Origin', origin)
      .set('Cookie', fixture.employee.cookie)
      .expect(204);
    await get(fixture.employee.cookie, url).expect(404);
  });

  it('projects readable columns and widths and never serves or executes a hidden filter', async () => {
    const base = {
      name: '团队筛选',
      scope: 'SHARED',
      columnFieldKeys: ['name', 'secret'],
      columnWidths: { name: 200, secret: 355 },
    };
    const visible = await post(fixture.admin.cookie, base).expect(201);
    const employeeView = await get(
      fixture.employee.cookie,
      `${path}/${view(visible).id}`,
    ).expect(200);
    expect(employeeView.body).toMatchObject({
      available: true,
      canEdit: false,
      columnFieldKeys: ['name'],
      columnWidths: { name: 200 },
    });
    expect(employeeView.text).not.toContain('secret');
    const filterRule = {
      version: 1,
      match: 'any',
      conditions: [
        {
          match: 'all',
          conditions: [
            { fieldKey: 'secret', operator: 'eq', value: 'sensitive-phrase' },
          ],
        },
      ],
    };
    const restricted = await post(fixture.admin.cookie, {
      ...base,
      filterRule,
    }).expect(201);
    const url = `${path}/${view(restricted).id}`;
    const details = await get(fixture.employee.cookie, url).expect(200);
    const list = await get(fixture.employee.cookie, path).expect(200);
    expect(details.body).toMatchObject({
      available: false,
      unavailableReason: '该视图条件不可用',
    });
    expect(details.body).not.toHaveProperty('filterRule');
    expect(details.text + list.text).not.toMatch(/secret|sensitive-phrase/);
    for (const url of [records, records + '/export']) {
      const blocked = await get(
        fixture.employee.cookie,
        `${url}?viewId=${view(restricted).id}`,
      ).expect(400);
      expect(blocked.text).not.toMatch(/secret|sensitive-phrase/);
    }
    const invalid = await post(fixture.employee.cookie, {
      name: '另存',
      scope: 'PERSONAL',
      filterRule,
    }).expect(400);
    expect(invalid.text).not.toMatch(/secret|sensitive-phrase/);
    await post(fixture.employee.cookie, {
      name: '共享',
      scope: 'SHARED',
    }).expect(403);
  });

  it('validates saved options and layout against the publication, and evaluates $me for the current reader', async () => {
    const mine = {
      version: 1,
      match: 'all',
      conditions: [{ fieldKey: '$owner', operator: 'in', value: ['$me'] }],
    };
    const mineView = await post(fixture.admin.cookie, {
      name: '我负责的线索',
      scope: 'SHARED',
      filterRule: mine,
    }).expect(201);
    for (const person of [fixture.employee, fixture.otherEmployee]) {
      const result = await get(
        person.cookie,
        `${records}?viewId=${view(mineView).id}`,
      ).expect(200);
      const page = result.body as RecordPageResponseDto;
      expect(page.total).toBeGreaterThan(0);
      expect(
        page.items.every((row) => row.ownerMemberId === person.memberId),
      ).toBe(true);
      const own = await get(
        person.cookie,
        `${path}/${view(mineView).id}`,
      ).expect(200);
      expect(view(own).filterRule).toEqual(mine);
    }
    const adminResult = await get(
      fixture.admin.cookie,
      `${records}?viewId=${view(mineView).id}`,
    ).expect(200);
    expect((adminResult.body as RecordPageResponseDto).total).toBe(0);
    const base = { name: '草稿', scope: 'PERSONAL' };
    for (const invalid of [
      { columnWidths: { name: 10 } },
      { queryOptions: { page: 2 } },
      { queryOptions: { scope: 'team' } },
      { sort: { field: 'secret', direction: 'asc' } },
      { columnFieldKeys: ['secret'] },
      { queryOptions: { ownerMemberId: fixture.otherEmployee.memberId } },
    ]) {
      await post(fixture.employee.cookie, { ...base, ...invalid }).expect(400);
    }
  });
  it('round-trips activity and pool columns while preserving standard CSV headers and field access', async () => {
    const db = harness.adminDatabase;
    const cookie = fixture.employee.cookie;
    const selected = ['poolStatus', 'name', 'latestActivity'];
    const widths = { latestActivity: 240, poolStatus: 112 };
    const csv = (url: string) =>
      get(cookie, records + '/export' + url).expect(200);
    const header = (response: { text: string }) =>
      response.text.replace(/^\uFEFF/, '').split('\r\n')[0];
    await request(harness.app.getHttpServer())
      .post(records + '/' + fixture.ownedRecord.id + '/activities')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ activityType: 'NOTE', content: '只用于活动预览的原话' })
      .expect(201);
    const published = header(await csv(''));
    expect(published).toBe('业务编号,负责人,姓名,审核编号,创建时间,最近更新');
    await db.objectDefinition.update({
      where: { id: fixture.object.id },
      data: { poolEnabled: true },
    });
    try {
      const fallback = view(
        await post(cookie, { name: '继承发布列', scope: 'PERSONAL' }).expect(
          201,
        ),
      );
      expect(fallback.columnFieldKeys).toEqual(
        expect.arrayContaining(['latestActivity', 'poolStatus']),
      );
      expect(header(await csv('?viewId=' + fallback.id))).toBe(published);
      const named = view(
        await post(fixture.admin.cookie, {
          name: '最近沟通',
          scope: 'SHARED',
          columnFieldKeys: [...selected, 'secret'],
          columnWidths: widths,
        }).expect(201),
      );
      const read = view(await get(cookie, path + '/' + named.id).expect(200));
      expect(read.columnFieldKeys).toEqual(selected);
      expect(read.columnWidths).toEqual(widths);
      const result = await csv('?viewId=' + named.id);
      expect(header(result)).toBe('业务编号,负责人,姓名,创建时间,最近更新');
      expect(result.text).not.toMatch(
        /hidden-|内部备注|最近沟通|归属状态|只用于活动预览的原话/,
      );
      const systemOnly = view(
        await post(cookie, {
          name: '仅系统列',
          scope: 'PERSONAL',
          columnFieldKeys: ['poolStatus', 'latestActivity'],
        }).expect(201),
      );
      expect(header(await csv('?viewId=' + systemOnly.id))).toBe(
        '业务编号,负责人,创建时间,最近更新',
      );
      await db.objectDefinition.update({
        where: { id: fixture.object.id },
        data: { poolEnabled: false },
      });
      const after = view(await get(cookie, path + '/' + named.id).expect(200));
      expect(after.columnFieldKeys).toEqual(['name', 'latestActivity']);
      expect(after.columnWidths).toEqual({ latestActivity: 240 });
    } finally {
      await db.objectDefinition.update({
        where: { id: fixture.object.id },
        data: { poolEnabled: false },
      });
    }
  });

  it('intersects a saved group owner with live membership, field visibility, assigned tasks and export permission', async () => {
    const db = harness.adminDatabase;
    const { tenantA, employee, otherEmployee, admin, object, otherRecord } =
      fixture;
    const group = await db.memberGroup.create({
      data: { tenantId: tenantA.id, name: '视图测试小组' },
    });
    const owner = otherEmployee.memberId;
    const actor = {
      tenantId: tenantA.id,
      tenantCode: tenantA.code,
      userId: employee.userId,
      memberId: employee.memberId,
      role: 'EMPLOYEE' as const,
    };
    const service = harness.app.get(RecordsService);
    const due = new Date('2020-01-02T09:00:00Z');
    const peerTask = new Date('2020-01-01T09:00:00Z');
    let policyId: string | undefined;
    try {
      await db.tenantMember.updateMany({
        where: { tenantId: tenantA.id, id: { in: [actor.memberId, owner] } },
        data: { groupId: group.id },
      });
      await db.memberGroup.update({
        where: { id: group.id },
        data: { leaderMemberId: actor.memberId },
      });
      const policy = await db.objectPermission.create({
        data: {
          tenantId: tenantA.id,
          objectId: object.id,
          subjectType: 'MEMBER',
          subjectMemberId: actor.memberId,
          canRead: true,
          canCreate: true,
          canUpdate: true,
          canDelete: false,
          readScope: 'GROUP',
          updateScope: 'OWN',
          groupFieldAccess: {
            name: 'READ_ONLY',
            reviewCode: 'HIDDEN',
            secret: 'HIDDEN',
          },
        },
      });
      policyId = policy.id;
      await db.recordFollowUp.createMany({
        data: [
          { assigneeMemberId: actor.memberId, dueAt: due },
          { assigneeMemberId: owner, dueAt: peerTask },
        ].map((task) => ({
          ...task,
          tenantId: tenantA.id,
          recordId: otherRecord.id,
          title: group.id,
          status: 'OPEN',
        })),
      });
      const saved = view(
        await post(employee.cookie, {
          name: '组内同事待办',
          scope: 'PERSONAL',
          queryOptions: { scope: 'group', ownerMemberId: owner },
          sort: { field: 'nextFollowUpAt', direction: 'asc' },
          filterRule: {
            version: 1,
            match: 'all',
            conditions: [
              {
                fieldKey: '$followUp',
                operator: 'dueThroughToday',
                value: { assignee: 'any' },
              },
            ],
          },
        }).expect(201),
      );
      const seen = (
        await get(employee.cookie, records)
          .query({
            viewId: saved.id,
            scope: 'all',
            ownerMemberId: admin.memberId,
          })
          .expect(200)
      ).body as RecordPageResponseDto;
      expect(seen.total).toBe(1);
      expect(seen.items).toMatchObject([
        { id: otherRecord.id, nextFollowUpAt: due.toISOString() },
      ]);
      expect(seen.items[0].values).not.toHaveProperty('reviewCode');
      expect(
        (
          await service.aggregate(actor, object.code, {
            viewId: saved.id,
            aggregation: 'COUNT',
            limit: 10,
          })
        ).value,
      ).toBe('1');
      expect(
        (
          await get(employee.cookie, records + '/export')
            .query({ viewId: saved.id })
            .expect(200)
        ).text,
      ).toContain('他人线索');
      const shared = view(
        await post(admin.cookie, {
          name: '仅本人可见的列',
          scope: 'SHARED',
          sort: { field: 'reviewCode', direction: 'asc' },
        }).expect(201),
      );
      const unavailable = (
        await get(employee.cookie, path + '/' + shared.id).expect(200)
      ).body as RecordViewResponseDto;
      expect(unavailable.available).toBe(false);
      expect(unavailable.sort).toBeUndefined();
      await get(employee.cookie, records)
        .query({ viewId: shared.id })
        .expect(400);
      for (const outside of [admin.memberId, 'unassigned']) {
        await post(employee.cookie, {
          name: '组外',
          scope: 'PERSONAL',
          queryOptions: { scope: 'group', ownerMemberId: outside },
        }).expect(400);
      }
      await post(employee.cookie, {
        name: '组外负责人',
        scope: 'PERSONAL',
        filterRule: {
          version: 1,
          match: 'all',
          conditions: [
            { fieldKey: '$owner', operator: 'in', value: [admin.memberId] },
          ],
        },
      }).expect(400);
      await db.objectPermission.update({
        where: { id: policy.id },
        data: { canExport: false },
      });
      await get(employee.cookie, records + '/export')
        .query({ viewId: saved.id })
        .expect(403);
      await db.tenantMember.update({
        where: { id: owner },
        data: { groupId: null },
      });
      expect(
        (await get(employee.cookie, path + '/' + saved.id).expect(200)).body,
      ).toMatchObject({ available: false });
      await get(employee.cookie, records)
        .query({ viewId: saved.id })
        .expect(400);
    } finally {
      await db.recordFollowUp.deleteMany({
        where: {
          tenantId: tenantA.id,
          recordId: otherRecord.id,
          title: group.id,
        },
      });
      if (policyId)
        await db.objectPermission.delete({ where: { id: policyId } });
      await db.memberGroup.update({
        where: { id: group.id },
        data: { leaderMemberId: null },
      });
      await db.tenantMember.updateMany({
        where: { tenantId: tenantA.id, groupId: group.id },
        data: { groupId: null },
      });
      await db.memberGroup.delete({ where: { id: group.id } });
    }
  });
});
