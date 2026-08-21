import type {
  PublishedDataScope,
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

export function resolveEffectiveAccess(input: {
  schema: PublishedObjectSchema;
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

  const employeeAccess = input.schema.employeeAccess as
    PublishedObjectSchema['employeeAccess'] | undefined;

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
    fields: { ...employeeAccess.fields },
  };
}
