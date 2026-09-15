import type { PublishedField } from '../objects/object-schema';
import type { ActionOutput } from './action.types';
import {
  ActionValueError,
  resolveActionValue,
  resolveDateTimeSource,
  resolveMemberSource,
  resolveStringSource,
  type ActionValueContext,
} from './action-value-resolver';

/**
 * §15 / §12 / §16: unit tests for the ONE typed value mapping used by every
 * Action executor. The resolver is deliberately pure: it reads the immutable
 * source snapshot, the acting member, the clock and the earlier Action outputs
 * — never the database, the schema or the store — so the rules below are the
 * whole value-mapping policy of Action Engine V1.
 */

const CLOCK = new Date('2026-09-16T10:00:00.000Z');
const OWNER = '018f47a2-4b5c-7d8e-9f01-333333333333';
const ACTOR = '018f47a2-4b5c-7d8e-9f01-111111111111';
const OTHER = '018f47a2-4b5c-7d8e-9f01-999999999999';

function field(
  fieldKey: string,
  type: PublishedField['type'] = 'TEXT',
): PublishedField {
  return {
    id: `field-${fieldKey}`,
    fieldKey,
    label: fieldKey,
    type,
    required: false,
    defaultValue: null,
    validation: {},
    config: {},
    sortOrder: 10,
    isSystem: false,
  };
}

const SOURCE_FIELDS = [
  field('name', 'TEXT'),
  field('companyName', 'TEXT'),
  field('signedOn', 'DATE'),
  field('createdAt', 'DATETIME'),
  field('amount', 'NUMBER'),
  field('owner_ref', 'MEMBER'),
];

const SNAPSHOT_VALUES: Record<string, unknown> = {
  name: '张三',
  companyName: '白杰科技',
  signedOn: '2026-09-01',
  createdAt: '2026-09-01T08:00:00.000Z',
  amount: 12,
  owner_ref: null,
};

function context(overrides: Partial<ActionValueContext> = {}) {
  return {
    clock: () => CLOCK,
    actor: { memberId: ACTOR },
    source: {
      recordId: 'record-source',
      title: '原始线索',
      ownerMemberId: OWNER,
      values: SNAPSHOT_VALUES,
      fields: new Map(SOURCE_FIELDS.map((item) => [item.fieldKey, item])),
    },
    outputs: new Map<string, ActionOutput>(),
    ...overrides,
  } satisfies ActionValueContext;
}

function failure(run: () => unknown): ActionValueError {
  try {
    run();
  } catch (error) {
    return error as ActionValueError;
  }
  throw new Error('expected the resolver to reject');
}

describe('resolveActionValue', () => {
  it('passes a LITERAL through unchanged', () => {
    const ctx = context();

    expect(
      resolveActionValue({ source: 'LITERAL', value: '固定值' }, ctx),
    ).toBe('固定值');
    expect(resolveActionValue({ source: 'LITERAL', value: 42 }, ctx)).toBe(42);
    expect(resolveActionValue({ source: 'LITERAL', value: false }, ctx)).toBe(
      false,
    );
  });

  it('reads SOURCE_FIELD from the source snapshot values', () => {
    const ctx = context();

    expect(
      resolveActionValue(
        { source: 'SOURCE_FIELD', fieldKey: 'companyName' },
        ctx,
      ),
    ).toBe('白杰科技');
    expect(
      resolveActionValue({ source: 'SOURCE_FIELD', fieldKey: 'amount' }, ctx),
    ).toBe(12);
  });

  it('reads SOURCE_FIELD date and datetime values verbatim', () => {
    const ctx = context();

    expect(
      resolveActionValue(
        { source: 'SOURCE_FIELD', fieldKey: 'signedOn' },
        ctx,
        { targetFieldType: 'DATE' },
      ),
    ).toBe('2026-09-01');
    expect(
      resolveActionValue(
        { source: 'SOURCE_FIELD', fieldKey: 'createdAt' },
        ctx,
        { targetFieldType: 'DATETIME' },
      ),
    ).toBe('2026-09-01T08:00:00.000Z');
  });

  it('resolves a declared but unset SOURCE_FIELD to null', () => {
    const ctx = context();

    expect(
      resolveActionValue(
        { source: 'SOURCE_FIELD', fieldKey: 'owner_ref' },
        ctx,
      ),
    ).toBeNull();
  });

  it('rejects a SOURCE_FIELD the source publication does not have', () => {
    const error = failure(() =>
      resolveActionValue(
        { source: 'SOURCE_FIELD', fieldKey: 'ghost' },
        context(),
      ),
    );

    expect(error).toBeInstanceOf(ActionValueError);
    expect(error.reason).toContain('ghost');
  });

  it('reads SOURCE_META recordId, title and ownerMemberId from the snapshot', () => {
    const ctx = context();

    expect(
      resolveActionValue({ source: 'SOURCE_META', property: 'recordId' }, ctx),
    ).toBe('record-source');
    expect(
      resolveActionValue({ source: 'SOURCE_META', property: 'title' }, ctx),
    ).toBe('原始线索');
    expect(
      resolveActionValue(
        { source: 'SOURCE_META', property: 'ownerMemberId' },
        ctx,
      ),
    ).toBe(OWNER);
  });

  it('resolves a null SOURCE_META owner to null instead of failing', () => {
    const ctx = context();
    ctx.source.ownerMemberId = null;

    expect(
      resolveActionValue(
        { source: 'SOURCE_META', property: 'ownerMemberId' },
        ctx,
      ),
    ).toBeNull();
  });

  it('resolves ACTOR to the acting member', () => {
    const ctx = context();

    expect(resolveActionValue({ source: 'ACTOR' }, ctx)).toBe(ACTOR);
    expect(resolveActionValue({ source: 'ACTOR', memberId: ACTOR }, ctx)).toBe(
      ACTOR,
    );
  });

  it('rejects an ACTOR memberId that is not the acting member', () => {
    // Controller decision: a pinned memberId that differs from the actor is a
    // hard failure. Substituting the actor would be implicit privilege
    // elevation, and honouring `OTHER` would be a target-permission bypass.
    const error = failure(() =>
      resolveActionValue({ source: 'ACTOR', memberId: OTHER }, context()),
    );

    expect(error).toBeInstanceOf(ActionValueError);
    expect(error.reason).toContain('memberId');
  });

  it('resolves ACTION_OUTPUT from an earlier Action output', () => {
    const ctx = context({
      outputs: new Map<string, ActionOutput>([
        [
          'create-customer',
          {
            type: 'CREATE_RECORD',
            recordId: 'record-customer',
            objectCode: 'customers',
            recordNo: '12',
          },
        ],
        ['link', { type: 'CREATE_RELATION', relationId: 'relation-1' }],
      ]),
    });

    expect(
      resolveActionValue(
        {
          source: 'ACTION_OUTPUT',
          actionKey: 'create-customer',
          property: 'recordId',
        },
        ctx,
      ),
    ).toBe('record-customer');
    expect(
      resolveActionValue(
        {
          source: 'ACTION_OUTPUT',
          actionKey: 'create-customer',
          property: 'recordNo',
        },
        ctx,
      ),
    ).toBe('12');
    expect(
      resolveActionValue(
        { source: 'ACTION_OUTPUT', actionKey: 'link', property: 'relationId' },
        ctx,
      ),
    ).toBe('relation-1');
  });

  it('rejects a forward or unknown ACTION_OUTPUT reference', () => {
    const error = failure(() =>
      resolveActionValue(
        {
          source: 'ACTION_OUTPUT',
          actionKey: 'create-later',
          property: 'recordId',
        },
        context(),
      ),
    );

    expect(error).toBeInstanceOf(ActionValueError);
    expect(error.reason).toContain('create-later');
  });

  it('rejects an output property the referenced Action never produces', () => {
    const ctx = context({
      outputs: new Map<string, ActionOutput>([
        ['link', { type: 'CREATE_RELATION', relationId: 'relation-1' }],
      ]),
    });

    const error = failure(() =>
      resolveActionValue(
        { source: 'ACTION_OUTPUT', actionKey: 'link', property: 'recordId' },
        ctx,
      ),
    );

    expect(error).toBeInstanceOf(ActionValueError);
    expect(error.reason).toContain('recordId');
  });

  it('resolves NOW from the injected clock', () => {
    const ctx = context();

    expect(resolveActionValue({ source: 'NOW' }, ctx)).toBe(
      '2026-09-16T10:00:00.000Z',
    );
    expect(
      resolveActionValue({ source: 'NOW' }, ctx, { targetFieldType: 'DATE' }),
    ).toBe('2026-09-16');
  });

  it('resolves NOW_PLUS_DAYS from the injected clock', () => {
    const ctx = context();

    expect(resolveActionValue({ source: 'NOW_PLUS_DAYS', days: 0 }, ctx)).toBe(
      '2026-09-16T10:00:00.000Z',
    );
    expect(resolveActionValue({ source: 'NOW_PLUS_DAYS', days: 3 }, ctx)).toBe(
      '2026-09-19T10:00:00.000Z',
    );
    expect(
      resolveActionValue({ source: 'NOW_PLUS_DAYS', days: 2 }, ctx, {
        targetFieldType: 'DATE',
      }),
    ).toBe('2026-09-18');
    expect(
      resolveActionValue({ source: 'NOW_PLUS_DAYS', days: 3650 }, ctx),
    ).toBe('2036-09-13T10:00:00.000Z');
  });

  it.each([-1, 3651, 1.5, Number.NaN, '3', null])(
    'rejects the NOW_PLUS_DAYS offset %p',
    (days) => {
      // §22 (and Task 2's `requireDays`): integer 0..3650, re-checked at runtime
      // so a hand-edited publication cannot smuggle another offset in.
      const error = failure(() =>
        resolveActionValue(
          { source: 'NOW_PLUS_DAYS', days } as never,
          context(),
        ),
      );

      expect(error).toBeInstanceOf(ActionValueError);
      expect(error.reason).toContain('days');
    },
  );

  it('rejects a temporal source for a non-temporal target field', () => {
    // §15: NOW / NOW_PLUS_DAYS / LITERAL_DATETIME are *additional* date and
    // datetime sources, not general string formulas.
    const error = failure(() =>
      resolveActionValue({ source: 'NOW' }, context(), {
        targetFieldType: 'TEXT',
      }),
    );

    expect(error).toBeInstanceOf(ActionValueError);
  });

  it('passes LITERAL_DATETIME through for the target field validator', () => {
    const ctx = context();

    expect(
      resolveActionValue(
        { source: 'LITERAL_DATETIME', value: '2026-10-01T00:00:00.000Z' },
        ctx,
      ),
    ).toBe('2026-10-01T00:00:00.000Z');
    expect(
      resolveActionValue(
        { source: 'LITERAL_DATETIME', value: '2026-10-01' },
        ctx,
        { targetFieldType: 'DATE' },
      ),
    ).toBe('2026-10-01');
  });
});

describe('resolveMemberSource', () => {
  it('resolves ACTOR and SOURCE_OWNER', () => {
    const ctx = context();

    expect(resolveMemberSource({ source: 'ACTOR' }, ctx)).toBe(ACTOR);
    expect(resolveMemberSource({ source: 'SOURCE_OWNER' }, ctx)).toBe(OWNER);
  });

  it('rejects a null SOURCE_OWNER instead of substituting the actor', () => {
    // §22: "SOURCE_OWNER 为 null → validation fail". Falling back to the actor
    // would silently assign a follow-up / owner the operator never configured.
    const ctx = context();
    ctx.source.ownerMemberId = null;

    const error = failure(() =>
      resolveMemberSource({ source: 'SOURCE_OWNER' }, ctx),
    );

    expect(error).toBeInstanceOf(ActionValueError);
    expect(error.reason).toContain('负责人');
  });
});

describe('resolveStringSource', () => {
  it('resolves a LITERAL and a SOURCE_FIELD string', () => {
    const ctx = context();

    expect(resolveStringSource({ source: 'LITERAL', value: '回访' }, ctx)).toBe(
      '回访',
    );
    expect(
      resolveStringSource({ source: 'SOURCE_FIELD', fieldKey: 'name' }, ctx),
    ).toBe('张三');
  });

  it('rejects a SOURCE_FIELD that holds no string', () => {
    const ctx = context();

    for (const fieldKey of ['amount', 'owner_ref']) {
      const error = failure(() =>
        resolveStringSource({ source: 'SOURCE_FIELD', fieldKey }, ctx),
      );
      expect(error).toBeInstanceOf(ActionValueError);
      expect(error.reason).toContain(fieldKey);
    }
  });
});

describe('resolveDateTimeSource', () => {
  it('resolves NOW, NOW_PLUS_DAYS and LITERAL_DATETIME to an ISO instant', () => {
    const ctx = context();

    expect(resolveDateTimeSource({ source: 'NOW' }, ctx)).toBe(
      '2026-09-16T10:00:00.000Z',
    );
    expect(
      resolveDateTimeSource({ source: 'NOW_PLUS_DAYS', days: 7 }, ctx),
    ).toBe('2026-09-23T10:00:00.000Z');
    expect(
      resolveDateTimeSource(
        { source: 'LITERAL_DATETIME', value: '2026-10-01T09:00:00.000Z' },
        ctx,
      ),
    ).toBe('2026-10-01T09:00:00.000Z');
  });

  it('accepts a DATE or DATETIME SOURCE_FIELD', () => {
    const ctx = context();

    expect(
      resolveDateTimeSource(
        { source: 'SOURCE_FIELD', fieldKey: 'signedOn' },
        ctx,
      ),
    ).toBe('2026-09-01');
    expect(
      resolveDateTimeSource(
        { source: 'SOURCE_FIELD', fieldKey: 'createdAt' },
        ctx,
      ),
    ).toBe('2026-09-01T08:00:00.000Z');
  });

  it('rejects a SOURCE_FIELD that is not a date or datetime', () => {
    // §22: "SOURCE_FIELD 只能引用 DATE / DATETIME".
    const error = failure(() =>
      resolveDateTimeSource(
        { source: 'SOURCE_FIELD', fieldKey: 'name' },
        context(),
      ),
    );

    expect(error).toBeInstanceOf(ActionValueError);
    expect(error.reason).toContain('name');
  });

  it('rejects an unset or non-string temporal SOURCE_FIELD', () => {
    const ctx = context();

    for (const fieldKey of ['owner_ref']) {
      const error = failure(() =>
        resolveDateTimeSource({ source: 'SOURCE_FIELD', fieldKey }, ctx),
      );
      expect(error).toBeInstanceOf(ActionValueError);
    }
  });
});
