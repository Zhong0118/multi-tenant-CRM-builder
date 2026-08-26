import type { BusinessTemplateConfiguration } from './business-template.schema';
import { toTemplateDetail } from './business-template.presenter';
import type {
  BusinessTemplateRecord,
  BusinessTemplateVersion,
} from './business-templates.repository';

describe('business template presenter', () => {
  it('derives restored identity locks from the earliest published version', () => {
    const published = configuration('customers', 'name', 'TEXT');
    const restored = configuration(
      'renamed-customers',
      'renamed-name',
      'PHONE',
    );
    const record: BusinessTemplateRecord = {
      id: 'template-1',
      code: 'sales',
      name: '销售模板',
      description: null,
      draftVersion: 4,
      configuration: restored,
      activeVersionId: 'version-2',
      publishedAt: new Date('2026-08-26T02:00:00.000Z'),
      archivedAt: null,
      createdByUserId: 'user-1',
      createdAt: new Date('2026-08-26T00:00:00.000Z'),
      updatedAt: new Date('2026-08-26T03:00:00.000Z'),
      activeVersion: version(2, { schemaVersion: 1, objects: [] }),
      applicationCount: 0,
    };

    const detail = toTemplateDetail(record, [
      version(2, { schemaVersion: 1, objects: [] }),
      version(1, published),
    ]);

    expect(detail.configuration.objects[0]).toMatchObject({
      publishedCode: 'customers',
      fields: [{ publishedFieldKey: 'name', publishedType: 'TEXT' }],
    });
  });
});

function version(
  versionNo: number,
  configurationValue: BusinessTemplateConfiguration,
): BusinessTemplateVersion {
  return {
    id: `version-${versionNo}`,
    templateId: 'template-1',
    versionNo,
    sourceDraftVersion: versionNo,
    schemaVersion: 1,
    configuration: configurationValue,
    configurationChecksum: `checksum-${versionNo}`,
    changeSummary: [],
    publishedByUserId: 'user-1',
    publishedAt: new Date(`2026-08-26T0${versionNo}:00:00.000Z`),
  };
}

function configuration(
  code: string,
  fieldKey: string,
  type: 'TEXT' | 'PHONE',
): BusinessTemplateConfiguration {
  return {
    schemaVersion: 1,
    objects: [
      {
        id: 'object-1',
        code,
        name: '客户',
        description: null,
        icon: null,
        titleFieldKey: fieldKey,
        sortOrder: 1,
        status: 'ACTIVE',
        fields: [
          {
            id: 'field-1',
            fieldKey,
            label: '名称',
            type,
            required: true,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 1,
            isSystem: false,
            status: 'ACTIVE',
          },
        ],
        defaultView: {
          code: 'default',
          name: '全部',
          columnFieldKeys: [fieldKey],
          sort: { field: 'updatedAt', direction: 'desc' },
        },
        employeeAccess: {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: false,
          readScope: 'ALL',
          updateScope: 'OWN',
          fields: { [fieldKey]: 'EDIT' },
        },
      },
    ],
  };
}
