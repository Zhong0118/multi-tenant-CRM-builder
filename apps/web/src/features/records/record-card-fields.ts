import type {
  PublishedFieldView,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

export interface RecordCardFields {
  status?: PublishedFieldView;
  extras: PublishedFieldView[];
}

export function recordCardFields(
  schema: RuntimeObjectSchema,
  columnFieldKeys: string[] = schema.defaultView.columnFieldKeys,
): RecordCardFields {
  const visible = columnFieldKeys
    .map((fieldKey) => schema.fields.find((field) => field.fieldKey === fieldKey))
    .filter(
      (field): field is PublishedFieldView =>
        field !== undefined && field.access !== "HIDDEN",
    );

  const status = visible.find((field) => field.type === "SINGLE_SELECT");
  const extras = visible
    .filter(
      (field) =>
        field.fieldKey !== schema.object.titleFieldKey &&
        field.fieldKey !== status?.fieldKey,
    )
    .slice(0, 3);

  return { status, extras };
}
