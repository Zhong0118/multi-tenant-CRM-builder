import {
  analyzeTemplatePublication,
  type BusinessTemplateConfiguration,
} from './business-template-publication.policy';

function validTemplate(): BusinessTemplateConfiguration {
  return {
    schemaVersion: 1,
    objects: [
      {
        id: 'template-object-lead',
        code: 'leads',
        name: '销售线索',
        description: null,
        icon: 'contacts',
        titleFieldKey: 'name',
        sortOrder: 10,
        status: 'ACTIVE',
        fields: [
          {
            id: 'template-field-lead-name',
            fieldKey: 'name',
            label: '姓名',
            type: 'TEXT',
            required: true,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 10,
            isSystem: false,
            status: 'ACTIVE',
          },
          {
            id: 'template-field-lead-phone',
            fieldKey: 'phone',
            label: '手机号',
            type: 'PHONE',
            required: false,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 20,
            isSystem: false,
            status: 'ACTIVE',
          },
        ],
        defaultView: {
          code: 'default',
          name: '全部线索',
          columnFieldKeys: ['name', 'phone'],
          sort: { field: 'updatedAt', direction: 'desc' },
        },
        employeeAccess: {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: false,
          readScope: 'ALL',
          updateScope: 'OWN',
          fields: { name: 'EDIT', phone: 'READ_ONLY' },
        },
      },
      {
        id: 'template-object-company',
        code: 'companies',
        name: '客户公司',
        description: null,
        icon: 'building',
        titleFieldKey: 'name',
        sortOrder: 20,
        status: 'ACTIVE',
        fields: [
          {
            id: 'template-field-company-name',
            fieldKey: 'name',
            label: '公司名称',
            type: 'TEXT',
            required: true,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 10,
            isSystem: false,
            status: 'ACTIVE',
          },
          {
            id: 'template-field-company-email',
            fieldKey: 'email',
            label: '邮箱',
            type: 'EMAIL',
            required: false,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 20,
            isSystem: false,
            status: 'ACTIVE',
          },
        ],
        defaultView: {
          code: 'default',
          name: '全部公司',
          columnFieldKeys: ['name', 'email'],
          sort: { field: 'updatedAt', direction: 'desc' },
        },
        employeeAccess: {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: false,
          readScope: 'ALL',
          updateScope: 'OWN',
          fields: { name: 'EDIT', email: 'READ_ONLY' },
        },
      },
    ],
  };
}

describe('business template publication policy', () => {
  it('publishes a complete two-object template as a stable aggregate', () => {
    const analysis = analyzeTemplatePublication(validTemplate(), null);

    expect(analysis.blocking).toEqual([]);
    expect(analysis.objectCount).toBe(2);
    expect(analysis.fieldCount).toBe(4);
  });

  it('blocks duplicate active object codes', () => {
    const input = validTemplate();
    input.objects[1].code = input.objects[0].code;

    expect(analyzeTemplatePublication(input, null).blocking).toContainEqual({
      code: 'TEMPLATE_OBJECT_CODE_DUPLICATE',
      message: '业务对象代码在模板内必须唯一。',
      objectId: input.objects[1].id,
    });
  });

  it('locks published field keys and types', () => {
    const previous = validTemplate();
    const current = structuredClone(previous);
    current.objects[0].fields[0].type = 'NUMBER';

    expect(
      analyzeTemplatePublication(current, previous).blocking,
    ).toContainEqual({
      code: 'TEMPLATE_FIELD_IDENTITY_LOCKED',
      message: '已发布字段的字段键和类型不能修改。',
      objectId: current.objects[0].id,
      fieldKey: 'name',
    });
  });

  it('locks identities from an older version after the active version inactivated them', () => {
    const firstVersion = validTemplate();
    const activeVersion = structuredClone(firstVersion);
    activeVersion.objects = activeVersion.objects.slice(1);
    const restored = structuredClone(firstVersion);
    restored.objects[0].code = 'renamed-leads';
    restored.objects[0].fields[0].fieldKey = 'renamed-name';

    expect(
      analyzeTemplatePublication(restored, activeVersion, [
        firstVersion,
        activeVersion,
      ]).blocking,
    ).toEqual(
      expect.arrayContaining([
        {
          code: 'TEMPLATE_OBJECT_IDENTITY_LOCKED',
          message: '已发布对象的业务对象代码不能修改。',
          objectId: restored.objects[0].id,
        },
        {
          code: 'TEMPLATE_FIELD_IDENTITY_LOCKED',
          message: '已发布字段的字段键和类型不能修改。',
          objectId: restored.objects[0].id,
          fieldKey: 'renamed-name',
        },
      ]),
    );
  });
});
