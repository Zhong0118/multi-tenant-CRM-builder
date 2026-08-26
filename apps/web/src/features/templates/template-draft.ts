import type {
  ConfigurableFieldView,
  ConfigurableObjectView,
} from "../objects/configuration-view";
import type {
  FieldConfigView,
  FieldValidationView,
  PublishedDataScope,
  PublishedFieldAccess,
  PublishedFieldType,
  RecordSortDirection,
  RecordSortField,
  SelectOptionView,
} from "../objects/object-types";
import type {
  BusinessTemplateDetail,
  SaveTemplateDraftInput,
} from "./template-types";

export const TEMPLATE_OBJECT_CODE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const TEMPLATE_OBJECT_CODE_MESSAGE =
  "业务对象代码仅支持小写字母、数字和单个连字符，且必须以字母开头。";

export function isTemplateObjectCode(value: string): boolean {
  return TEMPLATE_OBJECT_CODE_PATTERN.test(value);
}

export interface TemplateFieldView extends ConfigurableFieldView {
  publishedFieldKey: string | null;
}

export interface TemplateObjectView extends ConfigurableObjectView {
  object: ConfigurableObjectView["object"] & {
    publishedCode: string | null;
    status: "ACTIVE" | "INACTIVE";
  };
  fields: TemplateFieldView[];
}

export interface TemplateDraft {
  schemaVersion: 1;
  objects: TemplateObjectView[];
}

export interface NewTemplateObject {
  id?: string;
  code?: string;
  name?: string;
}

export interface NewTemplateField {
  id?: string;
  fieldKey?: string;
  label?: string;
  type?: PublishedFieldType;
  required?: boolean;
}

export type EditableTemplateObjectPatch = Partial<
  Pick<
    TemplateObjectView["object"],
    "code" | "name" | "description" | "icon" | "titleFieldKey" | "status"
  >
>;

export type EditableTemplateFieldPatch = Partial<
  Pick<
    TemplateFieldView,
    | "fieldKey"
    | "label"
    | "type"
    | "required"
    | "defaultValue"
    | "validation"
    | "config"
    | "status"
    | "employeeAccess"
  >
>;

export interface TemplateFieldEditorValues {
  fieldKey: string;
  label: string;
  type: PublishedFieldType;
  required: boolean;
  employeeAccess: PublishedFieldAccess;
  options: SelectOptionView[];
  help: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  scale?: number;
}

export function templateDraftFromDetail(
  detail: Pick<BusinessTemplateDetail, "configuration">,
): TemplateDraft {
  return {
    schemaVersion: 1,
    objects: detail.configuration.objects.map((object) => ({
      object: {
        id: object.id,
        code: object.code,
        name: object.name,
        description: object.description,
        icon: object.icon,
        titleFieldKey: object.titleFieldKey,
        sortOrder: object.sortOrder,
        status: object.status,
        publishedCode: object.publishedCode,
      },
      fields: object.fields.map((field) => ({
        id: field.id,
        fieldKey: field.fieldKey,
        label: field.label,
        type: field.type,
        required: field.required,
        defaultValue: field.defaultValue,
        validation: field.validation as FieldValidationView,
        config: field.config as FieldConfigView,
        sortOrder: field.sortOrder,
        isSystem: field.isSystem,
        status: field.status,
        publishedFieldKey: field.publishedFieldKey,
        publishedType: field.publishedType,
        employeeAccess: object.employeeAccess?.fields[field.fieldKey] ?? "EDIT",
      })),
      defaultView: object.defaultView
        ? {
            name: object.defaultView.name,
            columnFieldKeys: [...object.defaultView.columnFieldKeys],
            sort: { ...object.defaultView.sort },
          }
        : null,
      employeeAccess: object.employeeAccess
        ? {
            canCreate: object.employeeAccess.canCreate,
            canRead: object.employeeAccess.canRead,
            canUpdate: object.employeeAccess.canUpdate,
            canDelete: false,
            readScope: object.employeeAccess.readScope,
            updateScope: object.employeeAccess.updateScope,
          }
        : null,
    })),
  };
}

/** A small deterministic fixture-shaped draft, also useful for helper callers. */
export function emptyTemplateDraft(): TemplateDraft {
  return {
    schemaVersion: 1,
    objects: [newObject({ id: "object-1", code: "object-1" }, 1)],
  };
}

export function addObject(
  draft: TemplateDraft,
  input: NewTemplateObject = {},
): TemplateDraft {
  const sortOrder = draft.objects.length + 1;
  return {
    ...draft,
    objects: [...draft.objects, newObject(input, sortOrder)],
  };
}

export function updateObject(
  draft: TemplateDraft,
  objectId: string,
  patch: EditableTemplateObjectPatch,
): TemplateDraft {
  return mapObject(draft, objectId, (object) => ({
    ...object,
    object: {
      ...object.object,
      code: patch.code ?? object.object.code,
      name: patch.name ?? object.object.name,
      description:
        patch.description !== undefined
          ? patch.description
          : object.object.description,
      icon: patch.icon !== undefined ? patch.icon : object.object.icon,
      titleFieldKey: patch.titleFieldKey ?? object.object.titleFieldKey,
      status: patch.status ?? object.object.status,
    },
  }));
}

export function addField(
  draft: TemplateDraft,
  objectId: string,
  input: NewTemplateField = {},
): TemplateDraft {
  return mapObject(draft, objectId, (object) => {
    const firstField = object.fields.length === 0;
    const fieldKey = input.fieldKey ?? `field_${object.fields.length + 1}`;
    const field: TemplateFieldView = {
      id: input.id ?? newStableId(),
      fieldKey,
      label: input.label ?? "新字段",
      type: input.type ?? "TEXT",
      required: input.required ?? firstField,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: object.fields.length + 1,
      isSystem: false,
      status: "ACTIVE",
      publishedFieldKey: null,
      publishedType: null,
      employeeAccess: "EDIT",
    };
    const nextFields = [...object.fields, field];
    return {
      ...object,
      object: {
        ...object.object,
        titleFieldKey: firstField ? fieldKey : object.object.titleFieldKey,
      },
      fields: nextFields,
      defaultView:
        object.defaultView ??
        ({
          name: "默认列表",
          columnFieldKeys: [fieldKey],
          sort: { field: "updatedAt", direction: "desc" },
        } as const),
      employeeAccess: object.employeeAccess ?? defaultEmployeeAccess(),
    };
  });
}

export function updateField(
  draft: TemplateDraft,
  objectId: string,
  fieldId: string,
  patch: EditableTemplateFieldPatch,
): TemplateDraft {
  return mapObject(draft, objectId, (object) => {
    const current = object.fields.find((field) => field.id === fieldId);
    if (!current) return object;
    const nextField: TemplateFieldView = {
      ...current,
      fieldKey: patch.fieldKey ?? current.fieldKey,
      label: patch.label ?? current.label,
      type: patch.type ?? current.type,
      required: patch.required ?? current.required,
      defaultValue:
        patch.defaultValue !== undefined
          ? patch.defaultValue
          : current.defaultValue,
      validation: patch.validation ?? current.validation,
      config: patch.config ?? current.config,
      status: patch.status ?? current.status,
      employeeAccess: patch.employeeAccess ?? current.employeeAccess,
    };
    const oldKey = current.fieldKey;
    const newKey = nextField.fieldKey;
    return {
      ...object,
      object: {
        ...object.object,
        titleFieldKey:
          object.object.titleFieldKey === oldKey
            ? newKey
            : object.object.titleFieldKey,
      },
      fields: object.fields.map((field) =>
        field.id === fieldId ? nextField : field,
      ),
      defaultView: object.defaultView
        ? {
            ...object.defaultView,
            columnFieldKeys: object.defaultView.columnFieldKeys.map((key) =>
              key === oldKey ? newKey : key,
            ),
          }
        : null,
    };
  });
}

export function setFieldStatus(
  draft: TemplateDraft,
  objectId: string,
  fieldId: string,
  status: "ACTIVE" | "INACTIVE",
): TemplateDraft {
  return mapObject(draft, objectId, (object) => {
    const field = object.fields.find((item) => item.id === fieldId);
    if (!field) return object;
    return {
      ...object,
      object: {
        ...object.object,
        titleFieldKey:
          status === "INACTIVE" &&
          object.object.titleFieldKey === field.fieldKey
            ? ""
            : object.object.titleFieldKey,
      },
      fields: object.fields.map((item) =>
        item.id === fieldId ? { ...item, status } : item,
      ),
      defaultView:
        status === "INACTIVE" && object.defaultView
          ? {
              ...object.defaultView,
              columnFieldKeys: object.defaultView.columnFieldKeys.filter(
                (fieldKey) => fieldKey !== field.fieldKey,
              ),
            }
          : object.defaultView,
    };
  });
}

export function buildFieldEditorPatch(
  field: TemplateFieldView,
  values: TemplateFieldEditorValues,
): EditableTemplateFieldPatch {
  const allowedValidationKeys = VALIDATION_KEYS_BY_TYPE[values.type] ?? [];
  const currentValidation = field.validation as Record<string, unknown>;
  const validation: Record<string, unknown> = {};
  for (const key of allowedValidationKeys) {
    const managedValue = managedValidationValue(values, key);
    if (managedValue !== undefined) {
      validation[key] = managedValue;
    } else if (key === "country" && currentValidation[key] !== undefined) {
      validation[key] = currentValidation[key];
    }
  }

  const config = { ...(field.config as Record<string, unknown>) };
  if (values.type === "SINGLE_SELECT" || values.type === "MULTI_SELECT") {
    config.options = values.options;
  } else {
    delete config.options;
  }
  if (values.help.trim()) config.help = values.help.trim();
  else delete config.help;

  return {
    fieldKey: values.fieldKey.trim(),
    label: values.label.trim(),
    type: values.type,
    required: values.required,
    employeeAccess: values.employeeAccess,
    validation: validation as FieldValidationView,
    config: config as FieldConfigView,
  };
}

export function reorderObjects(
  draft: TemplateDraft,
  objectIds: string[],
): TemplateDraft {
  const ordered = orderByIds(
    draft.objects,
    objectIds,
    (item) => item.object.id,
  );
  return {
    ...draft,
    objects: ordered.map((object, index) => ({
      ...object,
      object: { ...object.object, sortOrder: index + 1 },
    })),
  };
}

export function reorderFields(
  draft: TemplateDraft,
  objectId: string,
  fieldIds: string[],
): TemplateDraft {
  return mapObject(draft, objectId, (object) => ({
    ...object,
    fields: orderByIds(object.fields, fieldIds, (field) => field.id).map(
      (field, index) => ({ ...field, sortOrder: index + 1 }),
    ),
  }));
}

export function setDefaultView(
  draft: TemplateDraft,
  objectId: string,
  view: {
    name: string;
    columnFieldKeys: string[];
    sort: { field: RecordSortField; direction: RecordSortDirection };
  } | null,
): TemplateDraft {
  return mapObject(draft, objectId, (object) => ({
    ...object,
    defaultView: view
      ? {
          name: view.name,
          columnFieldKeys: [...view.columnFieldKeys],
          sort: { ...view.sort },
        }
      : null,
  }));
}

export function setEmployeeAccess(
  draft: TemplateDraft,
  objectId: string,
  access: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: false;
    readScope: PublishedDataScope;
    updateScope: PublishedDataScope;
    fields?: Record<string, PublishedFieldAccess>;
  } | null,
): TemplateDraft {
  return mapObject(draft, objectId, (object) => ({
    ...object,
    employeeAccess: access
      ? {
          canCreate: access.canCreate,
          canRead: access.canRead,
          canUpdate: access.canUpdate,
          canDelete: false,
          readScope: access.readScope,
          updateScope: access.updateScope,
        }
      : null,
    fields: object.fields.map((field) => ({
      ...field,
      employeeAccess: access?.fields?.[field.fieldKey] ?? field.employeeAccess,
    })),
  }));
}

export function toTemplateConfiguration(
  draft: TemplateDraft,
): SaveTemplateDraftInput["configuration"] {
  return {
    schemaVersion: 1,
    objects: draft.objects.map((object) => ({
      id: object.object.id,
      code: object.object.code,
      name: object.object.name,
      description: object.object.description,
      icon: object.object.icon,
      titleFieldKey: object.object.titleFieldKey,
      sortOrder: object.object.sortOrder,
      status: object.object.status,
      fields: object.fields.map((field) => ({
        id: field.id,
        fieldKey: field.fieldKey,
        label: field.label,
        type: field.type,
        required: field.required,
        defaultValue: field.defaultValue as never,
        validation: field.validation as Record<string, unknown>,
        config: field.config as Record<string, unknown>,
        sortOrder: field.sortOrder,
        isSystem: field.isSystem,
        status: field.status,
      })),
      defaultView: object.defaultView
        ? {
            code: "default",
            name: object.defaultView.name,
            columnFieldKeys: [...object.defaultView.columnFieldKeys],
            sort: { ...object.defaultView.sort },
          }
        : null,
      employeeAccess: object.employeeAccess
        ? {
            ...object.employeeAccess,
            canDelete: false,
            fields: Object.fromEntries(
              object.fields.map((field) => [
                field.fieldKey,
                field.employeeAccess,
              ]),
            ),
          }
        : null,
    })),
  };
}

function newObject(
  input: NewTemplateObject,
  sortOrder: number,
): TemplateObjectView {
  return {
    object: {
      id: input.id ?? newStableId(),
      code: input.code ?? `object-${sortOrder}`,
      name: input.name ?? "新业务对象",
      description: null,
      icon: null,
      titleFieldKey: "",
      sortOrder,
      status: "ACTIVE",
      publishedCode: null,
    },
    fields: [],
    defaultView: null,
    employeeAccess: defaultEmployeeAccess(),
  };
}

function defaultEmployeeAccess(): NonNullable<
  TemplateObjectView["employeeAccess"]
> {
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
    readScope: "ALL",
    updateScope: "OWN",
  };
}

function mapObject(
  draft: TemplateDraft,
  objectId: string,
  change: (object: TemplateObjectView) => TemplateObjectView,
): TemplateDraft {
  return {
    ...draft,
    objects: draft.objects.map((object) =>
      object.object.id === objectId ? change(object) : object,
    ),
  };
}

function orderByIds<T>(
  items: T[],
  ids: string[],
  idOf: (item: T) => string,
): T[] {
  const byId = new Map(items.map((item) => [idOf(item), item]));
  const ordered = ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const listed = new Set(ids);
  return [...ordered, ...items.filter((item) => !listed.has(idOf(item)))];
}

function newStableId(): string {
  return globalThis.crypto.randomUUID();
}

const VALIDATION_KEYS_BY_TYPE: Partial<
  Record<PublishedFieldType, readonly string[]>
> = {
  TEXT: ["minLength", "maxLength"],
  TEXTAREA: ["minLength", "maxLength"],
  PHONE: ["minLength", "maxLength", "country"],
  NUMBER: ["min", "max", "scale"],
  MONEY: ["min", "max", "scale"],
};

function managedValidationValue(
  values: TemplateFieldEditorValues,
  key: string,
): number | undefined {
  if (key === "minLength") return values.minLength;
  if (key === "maxLength") return values.maxLength;
  if (key === "min") return values.min;
  if (key === "max") return values.max;
  if (key === "scale") return values.scale;
  return undefined;
}
