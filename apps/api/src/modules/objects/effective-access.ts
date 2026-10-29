import type {
  PublishedDataScope,
  MemberReadScope,
  PublishedField,
  PublishedFieldAccess,
  PublishedObjectSchema,
} from './object-schema';

export interface ObjectAccessPolicy {
  groupFieldAccess?: Record<string, PublishedFieldAccess> | null;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  readScope: MemberReadScope;
  updateScope: PublishedDataScope;
}

export interface EffectiveObjectAccess extends ObjectAccessPolicy {
  /** Resolved from live membership; never supplied by a client. */
  groupOwnerMemberIds?: string[];
  memberId?: string;
  groupTitleHidden?: boolean;
  ownTitleHidden?: boolean;
  fields: Record<string, PublishedFieldAccess>;
}

/**
 * What `resolveEffectiveAccess` actually reads from a schema. `PublishedObjectSchema`
 * satisfies it; so does the pending schema the publication analyzer projects
 * from a draft (`action-publication.policy.ts`), which is why the analyzer can
 * resolve employee access through this one implementation instead of repeating
 * the `isSystem` / default-access rules.
 */
export interface AccessibleObjectSchema {
  fields: ReadonlyArray<Pick<PublishedField, 'fieldKey' | 'isSystem'>>;
  employeeAccess?: NonNullable<PublishedObjectSchema['employeeAccess']> | null;
}

export function resolveEffectiveAccess(input: {
  schema: AccessibleObjectSchema;
  role: 'TENANT_ADMIN' | 'EMPLOYEE';
  memberId?: string;
  memberOverride?: ObjectAccessPolicy;
  groupOwnerMemberIds?: string[];
  memberFieldOverrides?: Record<string, PublishedFieldAccess>;
}): EffectiveObjectAccess {
  const fieldKeys = input.schema.fields.map((field) => field.fieldKey);

  if (input.role === 'TENANT_ADMIN') {
    return {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      readScope: 'ALL',
      updateScope: 'ALL',
      fields: Object.fromEntries(
        fieldKeys.map((fieldKey) => [fieldKey, 'EDIT']),
      ),
    };
  }

  const employeeAccess = input.schema.employeeAccess ?? undefined;

  if (!employeeAccess) {
    return {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
      readScope: 'NONE',
      updateScope: 'NONE',
      fields: Object.fromEntries(
        fieldKeys.map((fieldKey) => [fieldKey, 'HIDDEN']),
      ),
    };
  }

  const objectPolicy = input.memberOverride ?? employeeAccess;
  const access: EffectiveObjectAccess = {
    canCreate: objectPolicy.canCreate,
    canRead: objectPolicy.canRead,
    canUpdate: objectPolicy.canUpdate,
    canDelete: false,
    readScope:
      objectPolicy.readScope === 'GROUP' && !input.groupOwnerMemberIds
        ? 'OWN'
        : objectPolicy.readScope,
    ...(objectPolicy.readScope === 'GROUP' && input.groupOwnerMemberIds
      ? { groupOwnerMemberIds: input.groupOwnerMemberIds }
      : {}),
    updateScope: objectPolicy.updateScope,
    fields: Object.fromEntries(
      input.schema.fields.map((field) => [
        field.fieldKey,
        field.isSystem
          ? 'READ_ONLY'
          : (input.memberFieldOverrides?.[field.fieldKey] ??
            employeeAccess.fields[field.fieldKey] ??
            'EDIT'),
      ]),
    ),
  };
  if (
    objectPolicy.readScope === 'GROUP' &&
    input.groupOwnerMemberIds &&
    objectPolicy.groupFieldAccess != null
  ) {
    access.memberId = input.memberId;
    access.groupFieldAccess = Object.fromEntries(
      input.schema.fields.map((field) => {
        const configured = Object.hasOwn(
          objectPolicy.groupFieldAccess!,
          field.fieldKey,
        )
          ? objectPolicy.groupFieldAccess![field.fieldKey]
          : undefined;
        const fallback =
          access.fields[field.fieldKey] === 'HIDDEN' ? 'HIDDEN' : 'READ_ONLY';
        const value = configured ?? fallback;
        return [
          field.fieldKey,
          value === 'EDIT' && (field.isSystem || !access.canUpdate)
            ? 'READ_ONLY'
            : value,
        ];
      }),
    );
  }
  return access;
}

export function isGroupPeer(
  access: EffectiveObjectAccess,
  record: { ownerMemberId: string | null; inPublicPool?: boolean },
): boolean {
  return (
    !!access.groupFieldAccess &&
    !!access.memberId &&
    access.readScope === 'GROUP' &&
    !record.inPublicPool &&
    record.ownerMemberId !== null &&
    record.ownerMemberId !== access.memberId &&
    !!access.groupOwnerMemberIds?.includes(record.ownerMemberId)
  );
}

export function recordFieldAccess(
  access: EffectiveObjectAccess,
  record: { ownerMemberId: string | null; inPublicPool?: boolean },
): Record<string, PublishedFieldAccess> {
  return isGroupPeer(access, record) ? access.groupFieldAccess! : access.fields;
}

/** Mixed-scope queries must never inspect a field hidden in either scope. */
export function queryFieldAccess(
  access: EffectiveObjectAccess,
): Record<string, PublishedFieldAccess> {
  if (!access.groupFieldAccess || access.groupTitleHidden) return access.fields;
  if (access.ownTitleHidden) return access.groupFieldAccess;
  return Object.fromEntries(
    Object.entries(access.fields).map(([key, value]) => [
      key,
      (access.groupFieldAccess?.[key] ?? 'HIDDEN') === 'HIDDEN'
        ? 'HIDDEN'
        : value,
    ]),
  );
}
