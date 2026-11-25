import { randomUUID } from 'node:crypto';
import { AvatarService } from '../src/modules/users/avatar.service';
import { mkdtemp, rm, readdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

const origin = 'http://localhost:3000';
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC',
  'base64',
);
jest.setTimeout(120000);
describe('personal profiles (HTTP and PostgreSQL)', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  let dir: string;
  const get = (path: string, actor: CriticalActor = f.employee) =>
    request(h.app.getHttpServer()).get(path).set('Cookie', actor.cookie);
  const edit = (
    path: string,
    body: object,
    actor: CriticalActor = f.employee,
  ) =>
    request(h.app.getHttpServer())
      .patch('/api/v1/' + path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send(body);
  const upload = (file: Buffer, type: string) =>
    request(h.app.getHttpServer())
      .put('/api/v1/me/avatar')
      .set('Cookie', f.employee.cookie)
      .set('Origin', origin)
      .attach('file', file, { filename: 'avatar', contentType: type });
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'crm-avatar-'));
    process.env.AVATARS_STORAGE_DIR = dir;
    h = await createCriticalHarness();
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
    delete process.env.AVATARS_STORAGE_DIR;
    await rm(dir, { recursive: true, force: true });
  });
  it('updates the account name once, independently edits jobs and preserves company aliases', async () => {
    const second = await h.adminDatabase.tenantMember.create({
      data: {
        tenantId: f.tenantB.id,
        userId: f.employee.userId,
        role: 'EMPLOYEE',
        displayName: '小赵',
      },
    });
    await edit('me/profile', { displayName: '   ' }).expect(400);
    await edit('me/profile', { displayName: ' 赵晨 ' }).expect(200);
    const title = (member: string) => `me/memberships/${member}/job-title`;
    await edit(title(f.employee.memberId), { jobTitle: '  客户经理 ' }).expect(
      200,
    );
    await edit(title(second.id), { jobTitle: '主管' }).expect(200);
    await edit(title(f.otherEmployee.memberId), { jobTitle: '越权' }).expect(
      404,
    );
    await edit(title(second.id), { jobTitle: 'a'.repeat(51) }).expect(400);
    const memberships = await get('/api/v1/me/memberships').expect(200);
    expect(memberships.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: f.employee.memberId,
          memberDisplayName: null,
          displayName: '赵晨',
          jobTitle: '客户经理',
        }),
        expect.objectContaining({
          memberId: second.id,
          memberDisplayName: '小赵',
          displayName: '小赵',
          jobTitle: '主管',
        }),
      ]),
    );
    expect((await get('/api/v1/me').expect(200)).body).toMatchObject({
      displayName: '赵晨',
      jobTitle: null,
      avatarUrl: null,
    });
    expect(
      (await get('/api/v1/me?tenantCode=' + f.tenantB.code).expect(200)).body,
    ).toMatchObject({ jobTitle: '主管' });
    const roster = 'workspaces/' + f.tenantA.code + '/members';
    await edit(
      roster + '/' + f.employee.memberId + '/name',
      { jobTitle: '销售' },
      f.admin,
    ).expect(200);
    await edit(
      roster + '/' + f.employee.memberId + '/name',
      { jobTitle: '销售' },
      f.otherEmployee,
    ).expect(403);
    await edit(
      roster + '/' + second.id + '/name',
      { jobTitle: '销售' },
      f.admin,
    ).expect(404);
    const { items } = (await get('/api/v1/' + roster, f.admin).expect(200))
      .body as { items: unknown[] };
    const adminInOtherCompany = await h.adminDatabase.tenantMember.create({
      data: {
        userId: f.admin.userId,
        tenantId: f.tenantB.id,
        role: 'EMPLOYEE',
      },
    });
    await edit(
      roster + '/' + adminInOtherCompany.id + '/name',
      { jobTitle: '越权' },
      f.admin,
    ).expect(404);
    expect(items).toContainEqual(
      expect.objectContaining({
        id: f.employee.memberId,
        displayName: '赵晨',
        jobTitle: '销售',
      }),
    );
    await edit(title(second.id), { jobTitle: '  ' }).expect(200);
    expect(
      (await get('/api/v1/me?tenantCode=' + f.tenantB.code)).body,
    ).toMatchObject({ jobTitle: null });
    await h.adminDatabase.user.update({
      where: { id: f.otherEmployee.userId },
      data: { isPlatformAdmin: true },
    });
    await edit(
      roster + '/' + f.employee.memberId + '/name',
      { jobTitle: '销售' },
      f.otherEmployee,
    ).expect(403);
    await h.adminDatabase.tenant.update({
      where: { id: f.tenantB.id },
      data: { status: 'SUSPENDED' },
    });
    await edit(title(second.id), { jobTitle: '新职位' }).expect(403);
    expect((await get('/api/v1/me/memberships')).body).toHaveLength(1);
    expect(
      await h.adminDatabase.auditLog.count({
        where: {
          tenantId: null,
          actorId: f.employee.userId,
          action: 'account.profile_changed',
        },
      }),
    ).toBe(1);
    expect(
      await h.adminDatabase.auditLog.count({
        where: {
          tenantId: f.tenantA.id,
          actorId: f.admin.userId,
          resourceId: f.employee.memberId,
          action: 'membership.job_title_changed',
        },
      }),
    ).toBe(1);
  });
  it('serves only current avatars to authorized viewers with private caching', async () => {
    const { avatarUrl } = (await upload(pixel, 'image/png').expect(200))
      .body as { avatarUrl: string };
    expect(avatarUrl).toMatch(/^\/api\/v1\/users\//);
    await request(h.app.getHttpServer()).get(avatarUrl).expect(401);
    for (const viewer of [f.employee, f.admin]) {
      await get(avatarUrl, viewer)
        .expect(200)
        .expect('Content-Type', /^image\/webp/)
        .expect('Cache-Control', 'private, max-age=3600')
        .expect('X-Content-Type-Options', 'nosniff');
    }
    await get(avatarUrl, f.tenantBAdmin).expect(403);
    await h.adminDatabase.user.update({
      where: { id: f.tenantBAdmin.userId },
      data: { isPlatformAdmin: true },
    });
    await get(avatarUrl, f.tenantBAdmin).expect(200);
    await h.adminDatabase.tenantMember.update({
      where: { id: f.admin.memberId },
      data: { status: 'DISABLED' },
    });
    await get(avatarUrl, f.admin).expect(403);
    const next = (await upload(pixel, 'image/png').expect(200)).body as {
      avatarUrl: string;
    };
    expect(next.avatarUrl).not.toBe(avatarUrl);
    await get(avatarUrl).expect(404);
    await request(h.app.getHttpServer())
      .delete('/api/v1/me/avatar')
      .set('Cookie', f.employee.cookie)
      .set('Origin', origin)
      .expect(200);
    await get(next.avatarUrl).expect(404);
    expect(
      await h.adminDatabase.auditLog.count({
        where: {
          tenantId: null,
          actorId: f.employee.userId,
          action: 'account.avatar_changed',
        },
      }),
    ).toBe(3);
  });
  it('serializes concurrent uploads and reclaims old orphans while retaining a referenced image', async () => {
    const urls = await Promise.all([
      upload(pixel, 'image/png').expect(200),
      upload(pixel, 'image/png').expect(200),
    ]);
    const { avatarUrl } = (await get('/api/v1/me').expect(200)).body as {
      avatarUrl: string;
    };
    const obsolete = urls
      .map((response) => (response.body as { avatarUrl: string }).avatarUrl)
      .find((url) => url !== avatarUrl)!;
    await get(avatarUrl).expect(200);
    await get(obsolete).expect(404);
    const folder = join(dir, f.employee.userId);
    const [live] = await readdir(folder);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const orphan = randomUUID() + '.webp';
    const recent = randomUUID() + '.tmp';
    await writeFile(join(folder, orphan), pixel);
    await writeFile(join(folder, recent), pixel);
    for (const entry of [live, orphan])
      await utimes(join(folder, entry), old, old);
    await h.app.get(AvatarService).onModuleInit();
    expect((await readdir(folder)).sort()).toEqual([live, recent].sort());
  });
  it('rejects invalid multipart images without changing the current avatar', async () => {
    await upload(Buffer.from('fake png'), 'image/png').expect(400);
    await upload(Buffer.alloc(300 * 1024 + 1), 'image/png').expect(413);
    await request(h.app.getHttpServer())
      .put('/api/v1/me/avatar')
      .set('Cookie', f.employee.cookie)
      .set('Origin', origin)
      .attach('file', pixel, 'a.png')
      .attach('file', pixel, 'b.png')
      .expect(400);
    expect((await get('/api/v1/me')).body).toMatchObject({ avatarUrl: null });
  });
});
