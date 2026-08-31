import type { PublishedFieldType } from '../objects/object-schema';
import type { DashboardDefinitionV2 } from '../dashboards/dashboard.types';
import type { BusinessTemplateConfiguration } from './business-template.schema';
import type {
  BusinessTemplateRecord,
  BusinessTemplateVersion,
} from './business-templates.repository';

export type PresentedTemplateField =
  BusinessTemplateConfiguration['objects'][number]['fields'][number] & {
    publishedFieldKey: string | null;
    publishedType: PublishedFieldType | null;
  };

export type PresentedTemplateObject = Omit<
  BusinessTemplateConfiguration['objects'][number],
  'fields'
> & {
  publishedCode: string | null;
  fields: PresentedTemplateField[];
};

export interface PresentedTemplateConfiguration {
  schemaVersion: 1;
  objects: PresentedTemplateObject[];
  dashboard?: DashboardDefinitionV2;
}

export interface TemplateSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  draftVersion: number;
  activeVersion: Pick<
    BusinessTemplateVersion,
    'id' | 'versionNo' | 'sourceDraftVersion' | 'publishedAt'
  > | null;
  hasUnpublishedChanges: boolean;
  status: 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED';
  objectCount: number;
  fieldCount: number;
  applicationCount: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateDetail extends TemplateSummary {
  configuration: PresentedTemplateConfiguration;
}

export function toTemplateSummary(
  template: BusinessTemplateRecord,
): TemplateSummary {
  const activeObjects = template.configuration.objects.filter(
    (object) => object.status === 'ACTIVE',
  );
  const hasUnpublishedChanges =
    !template.activeVersion ||
    template.activeVersion.sourceDraftVersion !== template.draftVersion;
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    draftVersion: template.draftVersion,
    activeVersion: template.activeVersion
      ? {
          id: template.activeVersion.id,
          versionNo: template.activeVersion.versionNo,
          sourceDraftVersion: template.activeVersion.sourceDraftVersion,
          publishedAt: template.activeVersion.publishedAt,
        }
      : null,
    hasUnpublishedChanges,
    status: template.archivedAt
      ? 'ARCHIVED'
      : !template.activeVersion
        ? 'DRAFT'
        : hasUnpublishedChanges
          ? 'CHANGED'
          : 'PUBLISHED',
    objectCount: activeObjects.length,
    fieldCount: activeObjects.reduce(
      (count, object) =>
        count +
        object.fields.filter((field) => field.status === 'ACTIVE').length,
      0,
    ),
    applicationCount: template.applicationCount,
    publishedAt: template.publishedAt,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function toTemplateDetail(
  template: BusinessTemplateRecord,
  versions: BusinessTemplateVersion[] = template.activeVersion
    ? [template.activeVersion]
    : [],
): TemplateDetail {
  const { publishedObjectById, publishedFieldById } =
    collectPublishedIdentities(versions);
  return {
    ...toTemplateSummary(template),
    configuration: {
      schemaVersion: 1,
      objects: template.configuration.objects.map((object) => {
        const publishedObject = publishedObjectById.get(object.id);
        return {
          ...structuredClone(object),
          publishedCode: publishedObject?.code ?? null,
          fields: object.fields.map((field) => {
            const publishedField = publishedFieldById.get(
              identityKey(object.id, field.id),
            );
            return {
              ...structuredClone(field),
              publishedFieldKey: publishedField?.fieldKey ?? null,
              publishedType: publishedField?.type ?? null,
            };
          }),
        };
      }),
      ...(template.configuration.dashboard
        ? { dashboard: structuredClone(template.configuration.dashboard) }
        : {}),
    },
  };
}

function collectPublishedIdentities(versions: BusinessTemplateVersion[]) {
  const publishedObjectById = new Map<
    string,
    BusinessTemplateConfiguration['objects'][number]
  >();
  const publishedFieldById = new Map<
    string,
    BusinessTemplateConfiguration['objects'][number]['fields'][number]
  >();

  for (const version of [...versions].sort(
    (left, right) => left.versionNo - right.versionNo,
  )) {
    for (const object of version.configuration.objects) {
      if (!publishedObjectById.has(object.id)) {
        publishedObjectById.set(object.id, object);
      }
      for (const field of object.fields) {
        const fieldIdentityKey = identityKey(object.id, field.id);
        if (!publishedFieldById.has(fieldIdentityKey)) {
          publishedFieldById.set(fieldIdentityKey, field);
        }
      }
    }
  }

  return { publishedObjectById, publishedFieldById };
}

function identityKey(objectId: string, fieldId: string): string {
  return `${objectId}:${fieldId}`;
}
