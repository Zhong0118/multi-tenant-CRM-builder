import {
  analyzeObjectConfiguration,
  compileObjectConfiguration,
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

  it.each([
    {
      name: 'an omitted default value',
      mutate: (input: ObjectConfigurationDraft) => {
        input.fields[1].defaultValue = undefined as never;
      },
      code: 'FIELD_DEFAULT_VALUE_INVALID',
    },
    {
      name: 'a string maxLength',
      mutate: (input: ObjectConfigurationDraft) => {
        input.fields[1].type = 'PHONE';
        input.fields[1].validation = { maxLength: '100' };
      },
      code: 'FIELD_VALIDATION_INVALID',
    },
    {
      name: 'a negative minLength',
      mutate: (input: ObjectConfigurationDraft) => {
        input.fields[1].type = 'PHONE';
        input.fields[1].validation = { minLength: -1 };
      },
      code: 'FIELD_VALIDATION_INVALID',
    },
    {
      name: 'an incomplete select option',
      mutate: (input: ObjectConfigurationDraft) => {
        input.fields[1].type = 'SINGLE_SELECT';
        input.fields[1].config = { options: [{ key: 'new' }] };
      },
      code: 'FIELD_CONFIG_INVALID',
    },
  ])('rejects $name before publication', ({ mutate, code }) => {
    const input = validObjectConfiguration();
    mutate(input);

    const blocker = analyzeObjectConfiguration(input).blocking.find(
      (candidate) => candidate.code === code,
    );
    expect(blocker).toMatchObject({ code, fieldKey: 'email' });
    expect(blocker?.message).toEqual(expect.any(String));
  });

  it('rejects an object code that starts with a number', () => {
    const input = validObjectConfiguration();
    input.object.code = '9sales';

    expect(analyzeObjectConfiguration(input).blocking).toContainEqual({
      code: 'OBJECT_CODE_INVALID',
      message:
        '业务对象代码仅支持小写字母、数字和单个连字符，且必须以字母开头。',
    });
  });

  it('accepts supported phone metadata and a JSON default value', () => {
    const input = validObjectConfiguration();
    input.fields[1] = {
      ...input.fields[1],
      type: 'PHONE',
      defaultValue: '+8613900000000',
      validation: { country: 'CN', minLength: 8 },
      config: { placeholder: '请输入手机号' },
    };

    expect(
      analyzeObjectConfiguration(input).blocking.filter(
        (issue) => issue.fieldKey === 'email',
      ),
    ).toEqual([]);
  });

  it('omits inactive field permissions from the compiled snapshot while retaining the draft permission', () => {
    const input = validObjectConfiguration();
    input.fields[1].status = 'INACTIVE';
    input.defaultView!.columnFieldKeys = ['name'];
    if (!input.defaultView || !input.employeeAccess) {
      throw new Error('Expected a complete object configuration fixture');
    }

    const snapshot = compileObjectConfiguration({
      ...input,
      defaultView: input.defaultView,
      employeeAccess: input.employeeAccess,
    });

    expect(snapshot.employeeAccess.fields).toEqual({ name: 'EDIT' });
    expect(input.employeeAccess.fields).toEqual({
      name: 'EDIT',
      email: 'READ_ONLY',
    });
  });
});
