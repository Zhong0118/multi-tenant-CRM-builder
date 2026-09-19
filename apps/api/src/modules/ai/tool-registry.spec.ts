import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { PublishedObjectService } from '../objects/published-object.service';
import type { RecordsService } from '../records/records.service';
import { AiToolRegistry } from './tool-registry';

const context: TenantContext = {
  tenantId: 'tenant-a',
  tenantCode: 'demo',
  userId: 'user-a',
  memberId: 'member-a',
  role: 'EMPLOYEE',
};

const ACTOR_OVERRIDE_INPUT = {
  tenantId: 'other-tenant',
  memberId: 'other-member',
  userId: 'other-user',
  role: 'TENANT_ADMIN' as const,
  includeHidden: true,
  runAsAdmin: true,
};

const EXTRA_FORBIDDEN_KEYS = {
  readScope: 'ALL',
  bypassPermission: true,
};

function registry() {
  return new AiToolRegistry(
    {} as PublishedObjectService,
    {} as RecordsService,
  );
}

describe('AiToolRegistry', () => {
  it('enumerates exactly the seven read tool names', () => {
    expect(registry().names()).toEqual([
      'list_objects',
      'describe_object',
      'search_records',
      'get_record',
      'aggregate_records',
      'list_activities',
      'list_followups',
    ]);
  });

  it('returns those seven named tools for an actor', () => {
    const tools = registry().forActor(context, {});
    expect(tools.map((tool) => tool.name)).toEqual(registry().names());
  });

  it('rejects actor-override keys on every tool schema', () => {
    for (const tool of registry().forActor(context, {})) {
      const result = tool.inputSchema.safeParse(ACTOR_OVERRIDE_INPUT);
      expect(result.success).toBe(false);
    }
  });

  it('rejects readScope and bypassPermission on every tool schema', () => {
    for (const tool of registry().forActor(context, {})) {
      const result = tool.inputSchema.safeParse({
        ...ACTOR_OVERRIDE_INPUT,
        ...EXTRA_FORBIDDEN_KEYS,
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects assigneeMemberId on list_followups', () => {
    const followups = registry()
      .forActor(context, {})
      .find((tool) => tool.name === 'list_followups');
    expect(followups).toBeDefined();
    const result = followups!.inputSchema.safeParse({
      assigneeMemberId: 'member-other',
    });
    expect(result.success).toBe(false);
  });

  it('throws DATA_UNAVAILABLE from unimplemented tools', async () => {
    const unimplemented = ['list_followups'];
    const tools = registry().forActor(context, {});
    for (const name of unimplemented) {
      const tool = tools.find((entry) => entry.name === name);
      expect(tool).toBeDefined();
      await expect(tool!.execute({}, 'call-1')).rejects.toMatchObject({
        code: 'DATA_UNAVAILABLE',
      });
    }
  });
});
