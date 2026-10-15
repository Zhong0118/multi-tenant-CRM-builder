import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { components } from '@crm/contracts';
import {
  createCriticalHarness,
  closeCriticalHarness,
  provisionCriticalFixture,
  type CriticalHarness,
  type CriticalFixture,
} from './helpers/critical-fixture';

type Page = components['schemas']['RecordPageResponseDto'];
jest.setTimeout(120_000);

describe('Large record pages', () => {
  let harness: CriticalHarness;
  let fixture: CriticalFixture;
  beforeAll(async () => {
    harness = await createCriticalHarness();
    await harness.app.listen(0, '127.0.0.1');
    fixture = await provisionCriticalFixture(harness);
    await harness.adminDatabase.record.createMany({
      data: Array.from({ length: 1001 }, (_, index) => ({
        id: randomUUID(),
        tenantId: fixture.tenantA.id,
        objectId: fixture.object.id,
        recordNo: BigInt(10000 + index),
        title: `Page row ${index}`,
        data: { name: `Page row ${index}` },
        ownerMemberId: fixture.employee.memberId,
        createdByMemberId: fixture.admin.memberId,
      })),
    });
  });
  afterAll(async () => {
    if (harness) await closeCriticalHarness(harness);
  });

  it('returns 1000 distinct rows and continues on the next page', async () => {
    const base = `/api/v1/workspaces/${fixture.tenantA.code}/objects/${fixture.object.code}/records`;
    const first = await request(harness.app.getHttpServer())
      .get(`${base}?limit=1000&sort=recordNo&direction=asc`)
      .set('Cookie', fixture.admin.cookie)
      .expect(200);
    const second = await request(harness.app.getHttpServer())
      .get(`${base}?limit=1000&page=2&sort=recordNo&direction=asc`)
      .set('Cookie', fixture.admin.cookie)
      .expect(200);
    const a = first.body as Page,
      b = second.body as Page;
    expect(a.limit).toBe(1000);
    expect(a.items).toHaveLength(1000);
    expect(a.items.length + b.items.length).toBe(a.total);
    expect(new Set([...a.items, ...b.items].map((row) => row.id)).size).toBe(
      a.total,
    );
    await request(harness.app.getHttpServer())
      .get(`${base}?limit=1001`)
      .set('Cookie', fixture.admin.cookie)
      .expect(400);
  });

  it('keeps OWN restrictions when requesting a large page', async () => {
    const url = `/api/v1/workspaces/${fixture.tenantA.code}/objects/${fixture.object.code}/records?limit=1000`;
    const result = await request(harness.app.getHttpServer())
      .get(url)
      .set('Cookie', fixture.otherEmployee.cookie)
      .expect(200);
    const page = result.body as Page;
    expect(page.items.length).toBeGreaterThan(0);
    expect(
      page.items.every(
        (row) => row.ownerMemberId === fixture.otherEmployee.memberId,
      ),
    ).toBe(true);
    expect(page.items.every((row) => !row.title.startsWith('Page row '))).toBe(
      true,
    );
  });
});
