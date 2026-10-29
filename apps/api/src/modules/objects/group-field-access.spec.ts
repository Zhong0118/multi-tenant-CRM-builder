import {
  resolveEffectiveAccess,
  recordFieldAccess,
  queryFieldAccess,
} from './effective-access';

const schema = {
  fields: [
    { fieldKey: 'name', isSystem: false },
    { fieldKey: 'phone', isSystem: false },
    { fieldKey: 'note', isSystem: false },
    { fieldKey: 'system', isSystem: true },
  ],
  employeeAccess: {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false as const,
    readScope: 'OWN' as const,
    updateScope: 'OWN' as const,
    fields: {
      name: 'EDIT' as const,
      phone: 'EDIT' as const,
      note: 'HIDDEN' as const,
    },
  },
};
function resolve(
  canUpdate = true,
  leaders: string[] | undefined = ['me', 'peer'],
) {
  return resolveEffectiveAccess({
    schema,
    role: 'EMPLOYEE',
    memberId: 'me',
    groupOwnerMemberIds: leaders,
    memberOverride: {
      ...schema.employeeAccess,
      readScope: 'GROUP',
      canUpdate,
      groupFieldAccess: { phone: 'HIDDEN', note: 'EDIT', system: 'EDIT' },
    },
  });
}
describe('independent group fields', () => {
  it('keeps own fields and uses independent peer fields with fail-closed defaults', () => {
    const access = resolve();
    expect(recordFieldAccess(access, { ownerMemberId: 'me' })).toEqual({
      name: 'EDIT',
      phone: 'EDIT',
      note: 'HIDDEN',
      system: 'READ_ONLY',
    });
    expect(recordFieldAccess(access, { ownerMemberId: 'peer' })).toEqual({
      name: 'READ_ONLY',
      phone: 'HIDDEN',
      note: 'EDIT',
      system: 'READ_ONLY',
    });
    expect(queryFieldAccess(access)).toEqual({
      name: 'EDIT',
      phone: 'HIDDEN',
      note: 'HIDDEN',
      system: 'READ_ONLY',
    });
  });
  it('canUpdate dominates and revoked leaders cannot use stored grants', () => {
    expect(
      recordFieldAccess(resolve(false), { ownerMemberId: 'peer' }).note,
    ).toBe('READ_ONLY');
    expect(
      resolveEffectiveAccess({
        schema,
        role: 'EMPLOYEE',
        memberOverride: {
          ...schema.employeeAccess,
          readScope: 'GROUP',
          groupFieldAccess: { note: 'EDIT' },
        },
      }).groupFieldAccess,
    ).toBeUndefined();
  });
  it('does not inherit Object.prototype entries as configured field grants', () => {
    const access = resolveEffectiveAccess({
      schema: {
        ...schema,
        fields: [{ fieldKey: 'constructor', isSystem: false }],
        employeeAccess: {
          ...schema.employeeAccess,
          fields: { constructor: 'HIDDEN' as const },
        },
      },
      role: 'EMPLOYEE',
      memberId: 'me',
      groupOwnerMemberIds: ['me', 'peer'],
      memberOverride: {
        ...schema.employeeAccess,
        readScope: 'GROUP',
        groupFieldAccess: {},
      },
    });
    expect(
      recordFieldAccess(access, { ownerMemberId: 'peer' }).constructor,
    ).toBe('HIDDEN');
  });
  it('does not apply peer fields to pool, unassigned or cross-group records', () => {
    for (const record of [
      { ownerMemberId: null },
      { ownerMemberId: 'other' },
      { ownerMemberId: 'peer', inPublicPool: true },
    ])
      expect(recordFieldAccess(resolve(), record).phone).toBe('EDIT');
  });
});
