import type {
  PublishedFieldView,
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

export function canEditRecord(
  schema: Pick<RuntimeObjectSchema, "actions" | "scopes">,
  record: Pick<RecordSummary, "ownerMemberId" | "inPublicPool">,
  currentMemberId?: string,
  isAdmin = false,
): boolean {
  return (
    schema.actions.canUpdate &&
    (isAdmin || !record.inPublicPool) &&
    (schema.scopes.update === "ALL" ||
      (schema.scopes.update === "OWN" &&
        Boolean(currentMemberId) &&
        record.ownerMemberId === currentMemberId))
  );
}

/** Ordinary field updates alone may receive additional per-record authorization. */
export function canEditRecordFields(
  schema: Pick<RuntimeObjectSchema, "actions" | "scopes">,
  record: RecordSummary,
  currentMemberId?: string,
  isAdmin = false,
): boolean {
  return (
    schema.actions.canUpdate &&
    (isAdmin || !record.inPublicPool) &&
    (record.canEditFields ??
      canEditRecord(schema, record, currentMemberId, isAdmin))
  );
}

/** The response's actual row policy is authoritative, including omitted keys. */
export function recordFields(
  schema: RuntimeObjectSchema,
  record?: RecordSummary,
): PublishedFieldView[] {
  return schema.fields.flatMap((field) => {
    const access = record?.fieldAccess
      ? ((Object.hasOwn(record.fieldAccess, field.fieldKey)
          ? record.fieldAccess[field.fieldKey]
          : undefined) ?? "HIDDEN")
      : field.access;
    return access === "HIDDEN" ? [] : [{ ...field, access }];
  });
}

/** A shared table column can be visible in either own or teammate records. */
export function visibleFields(
  schema: RuntimeObjectSchema,
): PublishedFieldView[] {
  return schema.fields.filter(
    (field) =>
      field.access !== "HIDDEN" ||
      (schema.groupFieldAccess &&
        Object.hasOwn(schema.groupFieldAccess, field.fieldKey) &&
        schema.groupFieldAccess[field.fieldKey] !== undefined &&
        schema.groupFieldAccess[field.fieldKey] !== "HIDDEN"),
  );
}

/** Only fields visible throughout the queried scope can power query controls. */
export function queryFields(schema: RuntimeObjectSchema): PublishedFieldView[] {
  return schema.queryFieldKeys === undefined
    ? schema.fields.filter((field) => field.access !== "HIDDEN")
    : schema.fields.filter((field) =>
        schema.queryFieldKeys!.includes(field.fieldKey),
      );
}
