import { randomUUID } from 'node:crypto';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';
import type { CommunicationDraftResponseDto } from '../src/modules/ai/dto/communication-draft.dto';
import request from 'supertest';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

function body(response: { body: unknown }): CommunicationDraftResponseDto {
  return response.body as CommunicationDraftResponseDto;
}

const origin = 'http://localhost:3000';
jest.setTimeout(120000);
describe('record communication drafts', () => {
  let h: CriticalHarness, f: CriticalFixture, path: string;
  beforeAll(async () => {
    assertIsolatedTestDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TEST_DATABASE_ADMIN_URL,
    );
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
    f = await provisionCriticalFixture(h);
    path = `/api/v1/workspaces/${f.tenantA.code}/objects/${f.object.code}/records/${f.ownedRecord.id}/communication-drafts`;
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });
  const post = (url: string, body: object, cookie = f.employee.cookie) =>
    request(h.app.getHttpServer())
      .post(url)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send(body);
  it('records edited notes and task dates once, retains auditable results across retries', async () => {
    const requestId = randomUUID(),
      text = '预算还没批，下周再联系';
    const result = await post(path, { requestId, text }).expect(201);
    const { id, note, followUp, status } = body(result);
    expect(status).toBe('READY');
    expect(followUp?.evidence).toBeTruthy();
    expect(result.text).not.toContain('hidden-owned');
    expect(body(await post(path, { requestId, text })).id).toBe(id);
    const before = await h.adminDatabase.recordActivity.count({
      where: { recordId: f.ownedRecord.id },
    });
    const title = '周三跟进',
      dueAt = '2027-01-06T01:00:00.000Z';
    const confirmUrl = path + '/' + id + '/confirm';
    const partial = await post(confirmUrl, {
      items: [
        { itemKey: 'note', editedValue: note },
        { itemKey: 'followUp', editedValue: { title, dueAt: 'invalid' } },
      ],
    }).expect(200);
    expect(body(partial).results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemKey: 'note', status: 'EXECUTED' }),
        expect.objectContaining({ itemKey: 'followUp', status: 'FAILED' }),
      ]),
    );
    const items = [
      { itemKey: 'note', editedValue: note },
      { itemKey: 'followUp', editedValue: { title, dueAt } },
    ];
    const attempts = await Promise.all([
      post(confirmUrl, { items }),
      post(confirmUrl, { items }),
    ]);
    for (const confirmed of attempts) {
      expect(confirmed.status).toBe(200);
      for (const itemKey of ['note', 'followUp']) {
        const item = body(confirmed).results.find(
          (value) => value.itemKey === itemKey,
        );
        expect(item?.status).toBe('EXECUTED');
        expect(typeof item?.auditId).toBe('string');
      }
    }
    const restored = body(
      await request(h.app.getHttpServer())
        .get(path + '/' + id)
        .set('Cookie', f.employee.cookie)
        .expect(200),
    );
    const savedNote = restored.results.find((item) => item.itemKey === 'note');
    const savedTask = restored.results.find(
      (item) => item.itemKey === 'followUp',
    );
    expect(savedNote?.activity?.content).toBe(note);
    expect(savedTask?.followUp).toMatchObject({ title, dueAt });
    expect(
      await h.adminDatabase.recordActivity.count({
        where: { recordId: f.ownedRecord.id },
      }),
    ).toBe(before + 1);
    expect(
      await h.adminDatabase.recordFollowUp.count({
        where: { recordId: f.ownedRecord.id, title, dueAt: new Date(dueAt) },
      }),
    ).toBe(1);
    await request(h.app.getHttpServer())
      .get(path + '/' + id)
      .set('Cookie', f.otherEmployee.cookie)
      .expect((res) => expect([403, 404]).toContain(res.status));
  });
  it('rejects forged field changes and retains the original note after a fake outage', async () => {
    const text = '模拟服务不可用',
      draft = await post(path, { requestId: randomUUID(), text }).expect(201);
    expect(draft.body).toMatchObject({ status: 'FALLBACK', text, note: text });
    const url = path + '/' + body(draft).id + '/confirm';
    const refused = await post(url, {
      items: [
        { itemKey: 'fields', editedValue: { values: { secret: 'forged' } } },
      ],
    }).expect(200);
    expect(body(refused).results).toContainEqual(
      expect.objectContaining({ itemKey: 'fields', status: 'FAILED' }),
    );
    expect(refused.text).not.toContain('secret');
    const saved = await post(url, {
      items: [{ itemKey: 'note', editedValue: text }],
    }).expect(200);
    expect(body(saved).results).toContainEqual(
      expect.objectContaining({ itemKey: 'note', status: 'EXECUTED' }),
    );
  });
  it('respects administrator deletion in history and never recreates a deleted activity on retry', async () => {
    const created = body(
      await post(path, {
        requestId: randomUUID(),
        text: '仅保存客户沟通纪要',
      }).expect(201),
    );
    const url = path + '/' + created.id;
    const items = [
      { itemKey: 'note', editedValue: '管理员稍后删除这条测试纪要' },
    ];
    const confirmed = body(await post(url + '/confirm', { items }).expect(200));
    const result = confirmed.results.find((item) => item.itemKey === 'note');
    const activityId = result?.activity?.id;
    expect(activityId).toBeDefined();
    const activityPath =
      path.replace(/communication-drafts$/, 'activities') + '/' + activityId;
    const remove = (cookie: string) =>
      request(h.app.getHttpServer())
        .delete(activityPath)
        .set('Origin', origin)
        .set('Cookie', cookie);
    await remove(f.employee.cookie).expect(403);
    await remove(f.admin.cookie).expect(200);
    const read = body(
      await request(h.app.getHttpServer())
        .get(url)
        .set('Cookie', f.employee.cookie)
        .expect(200),
    );
    const repeated = body(await post(url + '/confirm', { items }).expect(200));
    for (const draft of [read, repeated]) {
      const item = draft.results.find((entry) => entry.itemKey === 'note');
      expect(item?.activity).toBeUndefined();
      expect(item?.auditId).toBe(result?.auditId);
    }
    expect(
      await h.adminDatabase.recordActivity.count({
        where: { recordId: f.ownedRecord.id, content: items[0].editedValue },
      }),
    ).toBe(0);
  });
  it('rechecks access before reading or confirming a previously generated draft', async () => {
    const text = '预算还没批，下周再联系';
    const created = body(
      await post(path, { requestId: randomUUID(), text }).expect(201),
    );
    const url = path + '/' + created.id;
    const permission = await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.employee.memberId,
        canRead: true,
        canUpdate: false,
        readScope: 'OWN',
        updateScope: 'NONE',
      },
    });
    try {
      const read = await request(h.app.getHttpServer())
        .get(url)
        .set('Cookie', f.employee.cookie);
      expect([403, 404]).toContain(read.status);
      expect(read.text).not.toContain(text);
      const confirm = await post(url + '/confirm', {
        items: [{ itemKey: 'note', editedValue: text }],
      });
      expect([403, 404]).toContain(confirm.status);
      expect(
        await h.adminDatabase.aiOperation.count({
          where: { draftId: created.id },
        }),
      ).toBe(0);
    } finally {
      await h.adminDatabase.objectPermission.delete({
        where: { id: permission.id },
      });
    }
  });
});
