import type {
  PublishedDataScope,
  PublishedField,
  PublishedFieldAccess,
  PublishedObjectSchema,
} from './object-schema';

export interface ObjectAccessPolicy {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  readScope: PublishedDataScope;
  updateScope: PublishedDataScope;
}

export interface EffectiveObjectAccess extends ObjectAccessPolicy {
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
  memberOverride?: ObjectAccessPolicy;
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
  return {
    canCreate: objectPolicy.canCreate,
    canRead: objectPolicy.canRead,
    canUpdate: objectPolicy.canUpdate,
    canDelete: false,
    readScope: objectPolicy.readScope,
    updateScope: objectPolicy.updateScope,
    fields: Object.fromEntries(
      input.schema.fields.map((field) => [
        field.fieldKey,
        field.isSystem
          ? 'READ_ONLY'
          : (employeeAccess.fields[field.fieldKey] ?? 'EDIT'),
      ]),
    ),
  };
}
