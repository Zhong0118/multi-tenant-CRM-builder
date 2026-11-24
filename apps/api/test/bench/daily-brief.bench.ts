// Run this opt-in benchmark with the e2e Jest configuration and --testRegex daily-brief.bench.ts.
import { writeFileSync } from 'node:fs';
import request from 'supertest';
import { Prisma } from '@crm/database';
import {
  createCriticalHarness,
  provisionCriticalFixture,
  closeCriticalHarness,
} from '../helpers/critical-fixture';
import { assertIsolatedTestDatabase } from '../helpers/isolated-database';
import {
  briefScope,
  briefSql,
  groupKeys,
} from '../../src/modules/ai/daily-brief/brief-query';

jest.setTimeout(240000);
it('measures checklist and largest drawer with 50k deterministic records', async () => {
  assertIsolatedTestDatabase(
    process.env.TEST_DATABASE_URL,
    process.env.TEST_DATABASE_ADMIN_URL,
  );
  const h = await createCriticalHarness(),
    db = h.adminDatabase;
  try {
    const f = await provisionCriticalFixture(h);
    const tenant = f.tenantA.id,
      me = f.employee.memberId;
    const [{ id: invoice }] = await db.objectDefinition.findMany({
      where: { tenantId: tenant, code: 'invoices' },
      select: { id: true },
    });
    // Four existing records in tenant A. One in ten new records is mine; 70% belong to a single peer.
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          'SET LOCAL session_replication_role=replica',
        );
        await tx.$executeRaw`INSERT INTO records(tenant_id,object_id,owner_member_id,record_no,title,data,status_key,created_at,updated_at,created_by_member_id)
 SELECT ${tenant}::uuid,CASE WHEN i%3=0 THEN ${invoice}::uuid ELSE ${f.object.id}::uuid END,
 CASE WHEN i%10=0 THEN ${me}::uuid WHEN i%10<=7 THEN ${f.otherEmployee.memberId}::uuid ELSE ${f.admin.memberId}::uuid END,
 i+100,'客户'||i,jsonb_build_object('name','客户'||i),CASE WHEN i%3=0 THEN NULL ELSE 'new' END,
 CURRENT_DATE-((i%57)+1),now(),${f.admin.memberId}::uuid FROM generate_series(1,49996) i`;
        await tx.$executeRaw`UPDATE records SET pool_stage='FOLLOWING',ownership_expires_at=now()+(record_no%6-2)*interval '1 day'
 WHERE tenant_id=${tenant}::uuid AND record_no%70=0`;
        await tx.$executeRaw`INSERT INTO record_activities(tenant_id,record_id,activity_type,content,actor_member_id,created_at)
 SELECT tenant_id,id,'NOTE','历史沟通',owner_member_id, CURRENT_DATE-(record_no%35)::int FROM records WHERE tenant_id=${tenant}::uuid AND record_no%2=0`;
        await tx.$executeRaw`INSERT INTO record_follow_ups(tenant_id,record_id,assignee_member_id,title,due_at,status,completed_at,updated_at)
 SELECT tenant_id,id,owner_member_id,'历史跟进',CURRENT_DATE-20,'DONE',CURRENT_DATE-(record_no%41)::int,now() FROM records WHERE tenant_id=${tenant}::uuid AND record_no%3=0`;
        await tx.$executeRaw`INSERT INTO record_follow_ups(tenant_id,record_id,assignee_member_id,title,due_at,updated_at)
 SELECT tenant_id,id,${me}::uuid,'本人跟进',CURRENT_DATE-2,now() FROM records WHERE tenant_id=${tenant}::uuid AND record_no%41=0`;
        await tx.$executeRaw`INSERT INTO record_transition_histories(tenant_id,object_definition_id,record_id,object_publication_id,transition_key,transition_label,from_state_key,from_state_label,to_state_key,to_state_label,actor_member_id,record_version_before,record_version_after,created_at)
 SELECT r.tenant_id,o.id,r.id,o.active_publication_id,'reopen','重开','qualified','已转化','new','新建',r.owner_member_id,1,2,CURRENT_DATE-(r.record_no%39)::int FROM records r JOIN object_definitions o ON r.object_id=o.id WHERE r.tenant_id=${tenant}::uuid AND o.code='leads' AND record_no%5=0`;
      },
      { timeout: 60000 },
    );
    await db.$executeRawUnsafe('ANALYZE');
    const get = async (suffix: string) => {
      const start = performance.now();
      const r = await request(h.app.getHttpServer())
        .get('/api/v1/workspaces/' + f.tenantA.code + '/daily-brief' + suffix)
        .set('Cookie', f.employee.cookie)
        .expect(200);
      return {
        ms: performance.now() - start,
        body: r.body as {
          groups: { key: (typeof groupKeys)[number]; total: number }[];
        },
      };
    };
    const cold = await get('');
    const group = cold.body.groups
      .slice(1)
      .sort(
        (a: { total: number }, b: { total: number }) => b.total - a.total,
      )[0].key;
    const drawer = '?group=' + group,
      coldDrawer = await get(drawer);
    async function measure(suffix: string) {
      for (let i = 0; i < 10; i++) await get(suffix);
      const samples: number[] = [];
      await Promise.all(
        Array.from({ length: 10 }, async () => {
          for (let i = 0; i < 20; i++) samples.push((await get(suffix)).ms);
        }),
      );
      samples.sort((a, b) => a - b);
      return {
        n: samples.length,
        p50: samples[99],
        p95: samples[189],
        max: samples[199],
      };
    }
    const list = await measure(''),
      page = await measure(drawer);
    const plans = await h.runtimeDatabase.$transaction(async (tx) => {
      const a = {
        tenantCode: f.tenantA.code,
        tenantId: tenant,
        ...f.employee,
        role: 'EMPLOYEE' as const,
      };
      await tx.$queryRaw`SELECT set_config('app.user_id',${a.userId},true), set_config('app.tenant_id',${tenant},true)`;
      const s = await briefScope(tx, a);
      const all = await tx.$queryRaw(
        Prisma.sql`EXPLAIN(ANALYZE,BUFFERS) ${briefSql(a, s, { kind: 'preview' })}`,
      );
      const drawerPlan = await tx.$queryRaw(
        Prisma.sql`EXPLAIN(ANALYZE,BUFFERS) ${briefSql(a, s, { kind: 'page', priority: groupKeys.indexOf(group) + 1 })}`,
      );
      return { all, drawerPlan };
    });
    const stats =
      await db.$queryRaw`SELECT version(), pg_size_pretty(pg_database_size(current_database())) AS database_size,
 current_setting('shared_buffers') AS shared_buffers,current_setting('work_mem') AS work_mem,current_setting('default_statistics_target') AS statistics_target,
 (SELECT count(*)::int FROM records WHERE tenant_id=${tenant}::uuid) AS records,
 (SELECT count(*)::int FROM records WHERE tenant_id=${tenant}::uuid AND owner_member_id=${me}::uuid) AS my_records,
 (SELECT count(*)::int FROM record_activities WHERE tenant_id=${tenant}::uuid) AS activities,
 (SELECT count(*)::int FROM record_follow_ups WHERE tenant_id=${tenant}::uuid AND status='DONE') AS completed,
 (SELECT count(*)::int FROM record_follow_ups WHERE tenant_id=${tenant}::uuid AND status='OPEN') AS open,
 (SELECT count(*)::int FROM record_transition_histories WHERE tenant_id=${tenant}::uuid) AS transitions`;
    const report = {
      stats,
      cold: cold.ms,
      coldDrawer: coldDrawer.ms,
      group,
      groups: cold.body.groups.map((g: { key: string; total: number }) => [
        g.key,
        g.total,
      ]),
      list,
      page,
      plans,
    };
    writeFileSync(
      process.env.BRIEF_BENCH_REPORT ?? '/tmp/daily-brief-bench.json',
      JSON.stringify(report, null, 2),
    );
    expect(Math.max(list.p95, page.p95)).toBeLessThan(300);
  } finally {
    await closeCriticalHarness(h);
  }
});
