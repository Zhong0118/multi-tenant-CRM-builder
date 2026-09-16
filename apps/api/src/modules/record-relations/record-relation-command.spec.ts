import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import {
  createRecordRelationCommand,
  recordRelationScope,
  resolveRecordRelationScope,
  type CreateRecordRelationCommandDeps,
  type RecordRelationScope,
} from './record-relation-command';

/**
 * §21 / §24 parity tests for the extracted transaction-aware CREATE_RELATION
 * command. The transaction client is faked, as in `records.repository.spec.ts`
 * / `workflow.repository.spec.ts`, but it answers by SQL shape (actor lock,
 * record lock, insert) so the assertions are about the relation policy the
 * command really applies, not about mock call ordering alone.
 */

const context: TenantContext = {
  tenantId: 'tenant-a',
  tenantCode: 'demo',
  userId: 'user-actor',
  memberId: 'member-actor',
  role: 'EMPLOYEE',
};
const meta = { requestId: 'req-1', ip: '127.0.0.1' };

const SOURCE_CODE = 'leads';
const TARGET_CODE = 'contacts';
const LOW_RECORD = '018f47a2-4b5c-7d8e-9f01-000000000001';
const HIGH_RECORD = '018f47a2-4b5c-7d8e-9f01-ffffffffffff';

/** Source is HIGH_RECORD, target LOW_RECORD, so ascending id order flips them. */
const relationalInput = {
  code: SOURCE_CODE,
  id: HIGH_RECORD,
  objectCode: TARGET_CODE,
  recordId: LOW_RECORD,
};

const EXISTING_RELATION_ID = '018f47a2-4b5c-7d8e-9f01-eeeeeeeeeeee';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function objectAccess(
  overrides: Partial<EffectiveObjectAccess> = {},
): EffectiveObjectAccess {
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    readScope: 'ALL',
    updateScope: 'ALL',
    fields: {},
    ...overrides,
  };
}

function resolvedObject(
  objectId: string,
  overrides: Partial<EffectiveObjectAccess> = {},
): ResolvedObjectSchema {
  return {
    schema: { object: { id: objectId } },
    access: objectAccess(overrides),
  } as unknown as ResolvedObjectSchema;
}

interface HarnessOptions {
  /** Rows the actor lock returns; defaults to the acting member's own role. */
  actors?: Array<{ role: string }>;
  /** Record ids that exist, are visible and are not soft-deleted. */
  visible?: string[];
  /** `true` makes the idempotent INSERT report a conflict (no rows). */
  duplicate?: boolean;
  accessByCode?: Record<string, Partial<EffectiveObjectAccess>>;
}

function harness(options: HarnessOptions = {}) {
  const sqlCalls: Array<{ sql: string; values: unknown[] }> = [];
  const recordReads: Array<{
    id: string;
    ownerMemberId?: string;
    deletedAt: null | Date;
  }> = [];
  const visible = new Set(options.visible ?? [LOW_RECORD, HIGH_RECORD]);

  const tx = {
    $queryRaw: jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('$').replace(/\s+/g, ' ').trim();
        sqlCalls.push({ sql, values });
        if (/FROM tenant_members m JOIN users/.test(sql))
          return options.actors ?? [{ role: context.role }];
        if (/^SELECT id FROM records/.test(sql)) {
          const id = values.find(
            (value): value is string =>
              typeof value === 'string' && visible.has(value),
          );
          return id ? [{ id }] : [];
        }
        if (/INSERT INTO record_relations/.test(sql))
          return options.duplicate ? [] : [{ id: String(values[0]) }];
        if (/^SELECT id FROM record_relations/.test(sql))
          return [{ id: EXISTING_RELATION_ID }];
        throw new Error(`unexpected SQL: ${sql}`);
      },
    ),
    record: {
      findFirst: jest.fn(
        (args: {
          where: { id: string; ownerMemberId?: string; deletedAt: null };
        }) => {
          recordReads.push(args.where);
          return visible.has(args.where.id)
            ? { id: args.where.id, title: '记录', object: { id: 'object' } }
            : null;
        },
      ),
    },
  };

  const scopeCalls: Array<{ code: string; id: string; write: boolean }> = [];
  const append = jest.fn().mockResolvedValue(undefined);
  const deps: CreateRecordRelationCommandDeps = {
    // The harness resolves through the REAL scope policy, so the 403/owner
    // assertions below exercise production rules rather than a test copy.
    resolveScope: jest.fn(
      (
        _ctx: TenantContext,
        code: string,
        id: string,
        write: boolean,
      ): Promise<RecordRelationScope> => {
        scopeCalls.push({ code, id, write });
        return Promise.resolve(
          recordRelationScope(
            resolvedObject(`object-${code}`, options.accessByCode?.[code]),
            context,
            id,
            write,
          ),
        );
      },
    ),
    audit: { append } as unknown as CreateRecordRelationCommandDeps['audit'],
  };

  return {
    tx,
    deps,
    append,
    sqlCalls,
    recordReads,
    scopeCalls,
    run: (input: typeof relationalInput) =>
      createRecordRelationCommand(tx as never, context, input, meta, deps),
    locks: () =>
      sqlCalls
        .filter((call) => /^SELECT id FROM records/.test(call.sql))
        .map((call) =>
          call.values.find(
            (value): value is string =>
              typeof value === 'string' && value.length === 36,
          )!,
        ),
    insert: () => sqlCalls.find((call) => /^INSERT/.test(call.sql)),
  };
}

async function rejection(promise: Promise<unknown>): Promise<ApiException> {
  try {
    await promise;
  } catch (error) {
    return error as ApiException;
  }
  throw new Error('expected the command to reject');
}

describe('createRecordRelationCommand', () => {
  it('writes the relation in the caller tenant transaction and audits there', async () => {
    const fixture = harness();

    const result = await fixture.run(relationalInput);

    expect(result.success).toBe(true);
    expect(result.relationId).toMatch(UUID_V4);

    const insert = fixture.insert()!;
    expect(insert).toBeDefined();
    const [generatedId, tenantId, first, second] = insert.values;
    expect(generatedId).toMatch(UUID_V4);
    expect(tenantId).toBe('tenant-a');
    expect([first, second]).toEqual([LOW_RECORD, HIGH_RECORD]);
    expect(fixture.append).toHaveBeenCalledTimes(1);
    expect(fixture.append).toHaveBeenCalledWith(fixture.tx, {
      tenantId: 'tenant-a',
      actorType: 'USER',
      actorId: 'user-actor',
      action: 'record.relation_added',
      resourceType: 'record',
      resourceId: HIGH_RECORD,
      after: { targetRecordId: LOW_RECORD },
      requestId: 'req-1',
      ip: '127.0.0.1',
    });
  });

  it('resolves the source with write permission and the target without it', async () => {
    const fixture = harness();

    await fixture.run(relationalInput);

    expect(fixture.scopeCalls).toEqual([
      { code: SOURCE_CODE, id: HIGH_RECORD, write: true },
      { code: TARGET_CODE, id: LOW_RECORD, write: false },
    ]);
  });

  it('rejects a source the actor cannot update', async () => {
    const fixture = harness({
      accessByCode: { [SOURCE_CODE]: { canUpdate: false } },
    });

    const error = await rejection(fixture.run(relationalInput));

    expect(error.code).toBe('OBJECT_ACTION_FORBIDDEN');
    expect(error.getStatus()).toBe(403);
    expect(fixture.sqlCalls).toHaveLength(0);
    expect(fixture.append).not.toHaveBeenCalled();
  });

  it('rejects a source whose update scope is NONE even when canUpdate is true', async () => {
    const fixture = harness({
      accessByCode: { [SOURCE_CODE]: { canUpdate: true, updateScope: 'NONE' } },
    });

    const error = await rejection(fixture.run(relationalInput));

    expect(error.code).toBe('OBJECT_ACTION_FORBIDDEN');
    expect(error.getStatus()).toBe(403);
    expect(fixture.sqlCalls).toHaveLength(0);
  });

  it('does not require update permission on the target side', async () => {
    const fixture = harness({
      accessByCode: {
        [TARGET_CODE]: { canUpdate: false, updateScope: 'NONE' },
      },
    });

    const result = await fixture.run(relationalInput);

    expect(result.success).toBe(true);
    expect(result.relationId).toMatch(UUID_V4);
  });

  it('scopes an OWN target (and an OWN source) to the acting member', async () => {
    const fixture = harness({
      accessByCode: { [TARGET_CODE]: { readScope: 'OWN' } },
    });

    await fixture.run(relationalInput);

    const [targetLock, sourceLock] = fixture.sqlCalls.filter((call) =>
      /^SELECT id FROM records/.test(call.sql),
    );
    // Target is locked first because its id sorts lower.
    expect(targetLock.values).toContain(context.memberId);
    // The source keeps readScope ALL, so its owner arm is NULL.
    expect(sourceLock.values).toContain(null);
    expect(fixture.recordReads.map((row) => row.id)).toEqual([
      LOW_RECORD,
      HIGH_RECORD,
    ]);
    expect(fixture.recordReads[0].ownerMemberId).toBe(context.memberId);
    expect(fixture.recordReads[1].ownerMemberId).toBeUndefined();
    expect(fixture.recordReads[0].deletedAt).toBeNull();
  });

  it('rejects a self-link before touching the database', async () => {
    const fixture = harness();

    const error = await rejection(
      fixture.run({
        ...relationalInput,
        objectCode: SOURCE_CODE,
        recordId: HIGH_RECORD.toUpperCase(),
      }),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.getStatus()).toBe(400);
    expect(fixture.sqlCalls).toHaveLength(0);
    expect(fixture.scopeCalls).toHaveLength(0);
    expect(fixture.append).not.toHaveBeenCalled();
  });

  it('lower-cases both ids before resolving, ordering, storing and auditing', async () => {
    const fixture = harness();

    await fixture.run({
      ...relationalInput,
      id: HIGH_RECORD.toUpperCase(),
      recordId: LOW_RECORD.toUpperCase(),
    });

    expect(fixture.scopeCalls).toEqual([
      { code: SOURCE_CODE, id: HIGH_RECORD, write: true },
      { code: TARGET_CODE, id: LOW_RECORD, write: false },
    ]);
    expect(fixture.insert()!.values.slice(1)).toEqual([
      'tenant-a',
      LOW_RECORD,
      HIGH_RECORD,
    ]);
    expect(fixture.append).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        resourceId: HIGH_RECORD,
        after: { targetRecordId: LOW_RECORD },
      }),
    );
  });

  it('locks the acting member first, exactly one ACTIVE row with the same role', async () => {
    const fixture = harness();

    await fixture.run(relationalInput);

    const first = fixture.sqlCalls[0];
    expect(first.sql).toContain('FROM tenant_members m JOIN users u');
    expect(first.sql).toContain("m.status='ACTIVE'");
    expect(first.sql).toContain("u.status='ACTIVE'");
    expect(first.sql).toContain('FOR UPDATE OF m');
    expect(first.values).toEqual(['tenant-a', 'member-actor', 'user-actor']);
    expect(fixture.recordReads).toHaveLength(2);
  });

  const actorCases: Array<[string, Array<{ role: string }>]> = [
    ['missing actor', []],
    ['changed role', [{ role: 'TENANT_ADMIN' }]],
    ['ambiguous actor rows', [{ role: 'EMPLOYEE' }, { role: 'EMPLOYEE' }]],
  ];
  it.each(actorCases)(
    'rejects a %s before any record lock',
    async (_label, actors) => {
      const fixture = harness({ actors });

      const error = await rejection(fixture.run(relationalInput));

      expect(error.code).toBe('WORKSPACE_FORBIDDEN');
      expect(error.getStatus()).toBe(403);
      expect(fixture.sqlCalls).toHaveLength(1);
      expect(fixture.recordReads).toHaveLength(0);
      expect(fixture.append).not.toHaveBeenCalled();
    },
  );

  it('locks both records in ascending id order', async () => {
    const fixture = harness();

    await fixture.run(relationalInput);

    expect(fixture.locks()).toEqual([LOW_RECORD, HIGH_RECORD]);
    expect(fixture.recordReads.map((row) => row.id)).toEqual([
      LOW_RECORD,
      HIGH_RECORD,
    ]);
  });

  it('requires both records to exist and not be deleted', async () => {
    const fixture = harness({ visible: [HIGH_RECORD] });

    const error = await rejection(fixture.run(relationalInput));

    expect(error.code).toBe('RECORD_NOT_FOUND');
    expect(error.getStatus()).toBe(404);
    const lockSql = fixture.sqlCalls[1].sql;
    expect(lockSql).toContain('deleted_at IS NULL');
    expect(lockSql).toContain('owner_member_id');
    expect(fixture.append).not.toHaveBeenCalled();
  });

  it('stores the deterministic pair through an idempotent insert', async () => {
    const fixture = harness();

    await fixture.run(relationalInput);

    expect(fixture.insert()!.sql).toContain(
      'ON CONFLICT (tenant_id,source_record_id,target_record_id) DO NOTHING RETURNING id',
    );
  });

  it('treats a duplicate relation as a silent no-op without an audit row', async () => {
    const fixture = harness({ duplicate: true });

    await expect(fixture.run(relationalInput)).resolves.toEqual({
      success: true,
      relationId: EXISTING_RELATION_ID,
    });

    expect(fixture.append).not.toHaveBeenCalled();
  });

  it('reports the id of the row the insert created', async () => {
    const fixture = harness();

    const result = await fixture.run(relationalInput);

    expect(result.relationId).toBe(String(fixture.insert()!.values[0]));
    // The insert itself is untouched: `ON CONFLICT DO NOTHING` still owns
    // idempotency, and the id arrives in the same `RETURNING` clause.
    expect(
      fixture.sqlCalls.filter((call) =>
        /^SELECT id FROM record_relations/.test(call.sql),
      ),
    ).toHaveLength(0);
  });

  it('merges the §30 action audit metadata into the domain audit', async () => {
    const fixture = harness();
    const actionMeta = {
      ...meta,
      actionAudit: {
        workflowExecutionId: 'execution-1',
        transitionKey: 'convert',
        actionKey: 'link-customer-contact',
        actionType: 'CREATE_RELATION',
      },
    };

    await createRecordRelationCommand(
      fixture.tx as never,
      context,
      relationalInput,
      actionMeta,
      fixture.deps,
    );

    expect(fixture.append).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        action: 'record.relation_added',
        after: {
          targetRecordId: LOW_RECORD,
          workflowExecutionId: 'execution-1',
          transitionKey: 'convert',
          actionKey: 'link-customer-contact',
          actionType: 'CREATE_RELATION',
        },
      }),
    );
  });
});

describe('recordRelationScope', () => {
  it('requires write access only on the source side', () => {
    expect(() =>
      recordRelationScope(
        resolvedObject('object-leads', { canUpdate: false }),
        context,
        LOW_RECORD,
        true,
      ),
    ).toThrow(ApiException);
    expect(() =>
      recordRelationScope(
        resolvedObject('object-leads', { updateScope: 'NONE' }),
        context,
        LOW_RECORD,
        true,
      ),
    ).toThrow(ApiException);
    expect(
      recordRelationScope(
        resolvedObject('object-contacts', { canUpdate: false }),
        context,
        LOW_RECORD,
        false,
      ),
    ).toEqual({
      id: LOW_RECORD,
      objectId: 'object-contacts',
      owner: undefined,
    });
  });

  it('lower-cases the id and scopes OWN reads to the acting member', () => {
    expect(
      recordRelationScope(
        resolvedObject('object-leads', { readScope: 'OWN' }),
        context,
        HIGH_RECORD.toUpperCase(),
        false,
      ),
    ).toEqual({
      id: HIGH_RECORD,
      objectId: 'object-leads',
      owner: context.memberId,
    });
    expect(
      recordRelationScope(
        resolvedObject('object-leads', {
          readScope: 'ALL',
          updateScope: 'OWN',
        }),
        context,
        HIGH_RECORD,
        true,
      ),
    ).toMatchObject({ owner: context.memberId });
  });
});

describe('resolveRecordRelationScope', () => {
  it('resolves a side through the published-object read path', async () => {
    const resolveRuntimeSchema = jest
      .fn()
      .mockResolvedValue(resolvedObject('object-leads'));

    const scope = await resolveRecordRelationScope(
      { resolveRuntimeSchema },
      context,
      SOURCE_CODE,
      HIGH_RECORD.toUpperCase(),
      false,
    );

    expect(resolveRuntimeSchema).toHaveBeenCalledWith(context, SOURCE_CODE);
    expect(scope).toEqual({
      id: HIGH_RECORD,
      objectId: 'object-leads',
      owner: undefined,
    });
  });

  it('propagates the read gate of the published-object read path', async () => {
    // §21: an unreadable target keeps failing with the current HTTP semantics.
    const forbidden = new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    const resolveRuntimeSchema = jest.fn().mockRejectedValue(forbidden);

    await expect(
      resolveRecordRelationScope(
        { resolveRuntimeSchema },
        context,
        TARGET_CODE,
        LOW_RECORD,
        false,
      ),
    ).rejects.toBe(forbidden);
  });
});
