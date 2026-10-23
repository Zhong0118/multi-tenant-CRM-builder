import type {
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
