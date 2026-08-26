import { createHash } from 'node:crypto';

import {
  analyzeObjectConfiguration,
  compileObjectConfiguration,
} from '../objects/object-configuration.policy';
import type { PublicationIssue } from '../objects/object-publication.policy';
import type {
  BusinessTemplateConfiguration,
  TemplateEmployeeAccess,
  TemplateFieldConfiguration,
  TemplateObjectConfiguration,
} from './business-template.schema';

export type {
  BusinessTemplateConfiguration,
  TemplateEmployeeAccess,
  TemplateFieldConfiguration,
  TemplateObjectConfiguration,
} from './business-template.schema';

export interface TemplatePublicationIssue extends PublicationIssue {
  objectId: string;
}

export interface TemplatePublicationChange {
  kind: 'ADDED' | 'UPDATED' | 'INACTIVATED';
  entity: 'OBJECT' | 'FIELD';
  objectId: string;
  fieldKey?: string;
}

export interface TemplatePublicationAnalysis {
  blocking: TemplatePublicationIssue[];
  warnings: TemplatePublicationIssue[];
  changes: TemplatePublicationChange[];
  objectCount: number;
  fieldCount: number;
}

export function analyzeTemplatePublication(
  input: BusinessTemplateConfiguration,
  previous: BusinessTemplateConfiguration | null,
  publishedHistory: BusinessTemplateConfiguration[] = previous
    ? [previous]
    : [],
): TemplatePublicationAnalysis {
  const activeObjects = input.objects.filter(
    (object) => object.status === 'ACTIVE',
  );
  const previousObjects = previous?.objects ?? [];
  const previousObjectById = new Map(
    previousObjects.map((object) => [object.id, object]),
  );
  const historicalObjectById = new Map<string, TemplateObjectConfiguration>();
  const historicalFieldById = new Map<string, TemplateFieldConfiguration>();
  for (const version of publishedHistory) {
    for (const object of version.objects) {
      if (!historicalObjectById.has(object.id)) {
        historicalObjectById.set(object.id, object);
      }
      for (const field of object.fields) {
        const fieldIdentityKey = identityKey(object.id, field.id);
        if (!historicalFieldById.has(fieldIdentityKey)) {
          historicalFieldById.set(fieldIdentityKey, field);
        }
      }
    }
  }
  const blocking: TemplatePublicationIssue[] = [];
  const warnings: TemplatePublicationIssue[] = [];

  blocking.push(...findTemplateIdentityBlockers(input));

  if (activeObjects.length === 0) {
    blocking.push({
      code: 'TEMPLATE_OBJECT_REQUIRED',
      message: '模板至少需要一个启用的业务对象。',
      objectId: '',
    });
  }

  const activeCodes = new Set<string>();
  for (const object of activeObjects) {
    if (activeCodes.has(object.code)) {
      blocking.push({
        code: 'TEMPLATE_OBJECT_CODE_DUPLICATE',
        message: '业务对象代码在模板内必须唯一。',
        objectId: object.id,
      });
    }
    activeCodes.add(object.code);

    if (!object.fields.some((field) => field.status === 'ACTIVE')) {
      blocking.push({
        code: 'TEMPLATE_OBJECT_FIELD_REQUIRED',
        message: '每个启用的业务对象至少需要一个启用字段。',
        objectId: object.id,
      });
    }

    const configuration = analyzeObjectConfiguration({
      object,
      fields: object.fields,
      defaultView: object.defaultView,
      employeeAccess: object.employeeAccess,
      previousFields: previousObjectById
        .get(object.id)
        ?.fields.filter((field) => field.status === 'ACTIVE'),
    });
    blocking.push(
      ...configuration.blocking.map((issue) => ({
        ...issue,
        objectId: object.id,
      })),
    );
    warnings.push(
      ...configuration.warnings.map((issue) => ({
        ...issue,
        objectId: object.id,
      })),
    );

    const historicalObject = historicalObjectById.get(object.id);
    if (historicalObject) {
      if (object.code !== historicalObject.code) {
        blocking.push({
          code: 'TEMPLATE_OBJECT_IDENTITY_LOCKED',
          message: '已发布对象的业务对象代码不能修改。',
          objectId: object.id,
        });
      }

      for (const field of object.fields) {
        const historicalField = historicalFieldById.get(
          identityKey(object.id, field.id),
        );
        if (
          historicalField &&
          (field.fieldKey !== historicalField.fieldKey ||
            field.type !== historicalField.type)
        ) {
          blocking.push({
            code: 'TEMPLATE_FIELD_IDENTITY_LOCKED',
            message: '已发布字段的字段键和类型不能修改。',
            objectId: object.id,
            fieldKey: field.fieldKey,
          });
        }
      }
    }
  }

  return {
    blocking,
    warnings,
    changes: analyzeTemplateChanges(activeObjects, previousObjects),
    objectCount: activeObjects.length,
    fieldCount: activeObjects.reduce(
      (count, object) =>
        count +
        object.fields.filter((field) => field.status === 'ACTIVE').length,
      0,
    ),
  };
}

export function findTemplateIdentityBlockers(
  input: BusinessTemplateConfiguration,
): TemplatePublicationIssue[] {
  const blocking: TemplatePublicationIssue[] = [];
  const objectIds = new Set<string>();
  for (const object of input.objects) {
    if (objectIds.has(object.id)) {
      blocking.push({
        code: 'TEMPLATE_OBJECT_ID_DUPLICATE',
        message: '业务对象 ID 在模板内必须唯一。',
        objectId: object.id,
      });
    }
    objectIds.add(object.id);

    const fieldIds = new Set<string>();
    const fieldKeys = new Set<string>();
    for (const field of object.fields) {
      if (fieldIds.has(field.id)) {
        blocking.push({
          code: 'TEMPLATE_FIELD_ID_DUPLICATE',
          message: '字段 ID 在业务对象内必须唯一。',
          objectId: object.id,
          fieldKey: field.fieldKey,
        });
      }
      fieldIds.add(field.id);
      if (fieldKeys.has(field.fieldKey)) {
        blocking.push({
          code: 'TEMPLATE_FIELD_KEY_DUPLICATE',
          message: '字段键在业务对象内必须唯一。',
          objectId: object.id,
          fieldKey: field.fieldKey,
        });
      }
      fieldKeys.add(field.fieldKey);
    }
  }
  return blocking;
}

export function compileTemplateVersion(
  input: BusinessTemplateConfiguration,
): BusinessTemplateConfiguration {
  return {
    schemaVersion: 1,
    objects: input.objects
      .filter((object) => object.status === 'ACTIVE')
      .sort(compareObjects)
      .map((object) => {
        if (!object.defaultView || !object.employeeAccess) {
          throw new Error('Template object configuration is incomplete');
        }

        const configuration = compileObjectConfiguration({
          object,
          fields: object.fields,
          defaultView: object.defaultView,
          employeeAccess: object.employeeAccess,
        });

        return {
          ...configuration.object,
          status: 'ACTIVE' as const,
          fields: configuration.fields.map((field) => ({
            ...field,
            status: 'ACTIVE' as const,
          })),
          defaultView: configuration.defaultView,
          employeeAccess: configuration.employeeAccess,
        };
      }),
  };
}

export function checksumTemplateConfiguration(
  configuration: BusinessTemplateConfiguration,
): string {
  return createHash('sha256')
    .update(stableJson(normalizeTemplateConfiguration(configuration)))
    .digest('hex');
}

function analyzeTemplateChanges(
  activeObjects: TemplateObjectConfiguration[],
  previousObjects: TemplateObjectConfiguration[],
): TemplatePublicationChange[] {
  const previousActiveObjects = previousObjects.filter(
    (object) => object.status === 'ACTIVE',
  );
  const previousObjectById = new Map(
    previousActiveObjects.map((object) => [object.id, object]),
  );
  const currentObjectIds = new Set(activeObjects.map((object) => object.id));
  const changes: TemplatePublicationChange[] = [];

  for (const object of activeObjects) {
    const previousObject = previousObjectById.get(object.id);
    if (!previousObject) {
      changes.push({ kind: 'ADDED', entity: 'OBJECT', objectId: object.id });
    } else if (!sameObjectDefinition(object, previousObject)) {
      changes.push({ kind: 'UPDATED', entity: 'OBJECT', objectId: object.id });
    }

    const configuration = analyzeObjectConfiguration({
      object,
      fields: object.fields,
      defaultView: object.defaultView,
      employeeAccess: object.employeeAccess,
      previousFields: previousObject?.fields.filter(
        (field) => field.status === 'ACTIVE',
      ),
    });
    changes.push(
      ...configuration.changes.map((change) => ({
        ...change,
        entity: 'FIELD' as const,
        objectId: object.id,
      })),
    );
  }

  for (const previousObject of previousActiveObjects) {
    if (!currentObjectIds.has(previousObject.id)) {
      changes.push({
        kind: 'INACTIVATED',
        entity: 'OBJECT',
        objectId: previousObject.id,
      });
      for (const field of previousObject.fields) {
        if (field.status === 'ACTIVE') {
          changes.push({
            kind: 'INACTIVATED',
            entity: 'FIELD',
            objectId: previousObject.id,
            fieldKey: field.fieldKey,
          });
        }
      }
    }
  }

  return changes;
}

function sameObjectDefinition(
  current: TemplateObjectConfiguration,
  previous: TemplateObjectConfiguration,
): boolean {
  return (
    current.code === previous.code &&
    current.name === previous.name &&
    current.description === previous.description &&
    current.icon === previous.icon &&
    current.titleFieldKey === previous.titleFieldKey &&
    current.sortOrder === previous.sortOrder &&
    JSON.stringify(current.defaultView) ===
      JSON.stringify(previous.defaultView) &&
    JSON.stringify(current.employeeAccess) ===
      JSON.stringify(previous.employeeAccess)
  );
}

function normalizeTemplateConfiguration(
  configuration: BusinessTemplateConfiguration,
): BusinessTemplateConfiguration {
  return {
    schemaVersion: configuration.schemaVersion,
    objects: [...configuration.objects].sort(compareObjects).map((object) => ({
      ...object,
      fields: [...object.fields].sort(compareFields),
    })),
  };
}

function compareObjects(
  left: TemplateObjectConfiguration,
  right: TemplateObjectConfiguration,
): number {
  return (
    left.sortOrder - right.sortOrder || left.code.localeCompare(right.code)
  );
}

function compareFields(
  left: TemplateFieldConfiguration,
  right: TemplateFieldConfiguration,
): number {
  return (
    left.sortOrder - right.sortOrder ||
    left.fieldKey.localeCompare(right.fieldKey)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function identityKey(objectId: string, fieldId: string): string {
  return `${objectId}:${fieldId}`;
}
