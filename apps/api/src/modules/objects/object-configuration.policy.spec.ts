import {
  analyzeObjectConfiguration,
  type ObjectConfigurationDraft,
} from './object-configuration.policy';

function validObjectConfiguration(): ObjectConfigurationDraft {
  return {
    object: {
      id: 'object-lead',
      code: 'leads',
      name: '销售线索',
      description: '首家公司使用的线索对象',
      titleFieldKey: 'name',
      icon: 'contacts',
      sortOrder: 20,
    },
    fields: [
      {
        id: 'field-name',
        fieldKey: 'name',
        label: '姓名',
        type: 'TEXT',
        required: true,
        defaultValue: null,
        validation: { maxLength: 100 },
        config: {},
        sortOrder: 10,
        isSystem: false,
        status: 'ACTIVE',
      },
      {
        id: 'field-email',
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
      name: '全部线索',
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
  };
}

describe('object configuration policy', () => {
  it('requires employee access for every active field', () => {
    const input = validObjectConfiguration();
    delete input.employeeAccess!.fields.email;

    expect(analyzeObjectConfiguration(input).blocking).toContainEqual({
      code: 'EMPLOYEE_FIELD_ACCESS_REQUIRED',
      message: '每个已启用字段都必须配置员工字段权限。',
      fieldKey: 'email',
    });
  });

  it('rejects numeric validation on a text field', () => {
    const input = validObjectConfiguration();
    input.fields[0].validation = { min: 1 };

    expect(analyzeObjectConfiguration(input).blocking).toContainEqual({
      code: 'FIELD_VALIDATION_INCOMPATIBLE',
      message: '字段校验配置与字段类型不匹配。',
      fieldKey: 'name',
    });
  });
});
