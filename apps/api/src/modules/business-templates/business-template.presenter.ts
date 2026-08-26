import type { PublishedFieldType } from '../objects/object-schema';
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
        count + object.fields.filter((field) => field.status === 'ACTIVE').length,
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
): TemplateDetail {
  const publishedObjectById = new Map(
    (template.activeVersion?.configuration.objects ?? []).map((object) => [
      object.id,
      object,
    ]),
  );
  return {
    ...toTemplateSummary(template),
    configuration: {
      schemaVersion: 1,
      objects: template.configuration.objects.map((object) => {
        const publishedObject = publishedObjectById.get(object.id);
        const publishedFieldById = new Map(
          (publishedObject?.fields ?? []).map((field) => [field.id, field]),
        );
        return {
          ...structuredClone(object),
          publishedCode: publishedObject?.code ?? null,
          fields: object.fields.map((field) => {
            const publishedField = publishedFieldById.get(field.id);
            return {
              ...structuredClone(field),
              publishedFieldKey: publishedField?.fieldKey ?? null,
              publishedType: publishedField?.type ?? null,
            };
          }),
        };
      }),
    },
  };
}
