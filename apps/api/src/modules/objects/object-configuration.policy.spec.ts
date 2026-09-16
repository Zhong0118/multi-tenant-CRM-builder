import {
  analyzeObjectConfiguration,
  compileObjectConfiguration,
  type ObjectConfigurationDraft,
} from './object-configuration.policy';
import type { PublicationDraftField } from './object-publication.policy';

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

  it('blocks a required field that is hidden from employees without a default', () => {
    const input = validObjectConfiguration();
    input.fields[1] = {
      ...input.fields[1],
      required: true,
      defaultValue: null,
    };
    input.employeeAccess!.fields.email = 'HIDDEN';

    const blocker = analyzeObjectConfiguration(input).blocking.find(
      (issue) => issue.code === 'REQUIRED_FIELD_HIDDEN',
    );
    expect(blocker).toMatchObject({ fieldKey: 'email' });
    // The message must name the field for the designer, since the whole point
    // is that employees can never fill it in.
    expect(blocker?.message).toContain('邮箱');
  });

  it('accepts a required field hidden from employees when a default fills it', () => {
    const input = validObjectConfiguration();
    input.fields[1] = {
      ...input.fields[1],
      required: true,
      defaultValue: 'default@example.com',
    };
    input.employeeAccess!.fields.email = 'HIDDEN';

    // The default is materialized on create, so this configuration is
    // legitimate: blocking it would be an over-rejection.
    expect(
      analyzeObjectConfiguration(input).blocking.filter(
        (issue) => issue.code === 'REQUIRED_FIELD_HIDDEN',
      ),
    ).toEqual([]);
  });

  // A non-null default is only a legitimate escape hatch when it actually lands
  // on create: the engine's `normalizeValue` rejects each of these shapes with
  // `FIELD_INVALID`/`FIELD_OPTION_INACTIVE`, so the record still cannot be
  // created for the employee while the key stays invisible.
  it.each([
    {
      name: 'an EMAIL default that is an empty string',
      mutate: (field: PublicationDraftField) => {
        field.type = 'EMAIL';
        field.defaultValue = '';
      },
    },
    {
      name: 'a SINGLE_SELECT default with an unknown option key',
      mutate: (field: PublicationDraftField) => {
        field.type = 'SINGLE_SELECT';
        field.defaultValue = 'missing';
        field.config = { options: [{ key: 'vip', label: '重点客户' }] };
      },
    },
    {
      name: 'a MULTI_SELECT default with one unknown option key',
      mutate: (field: PublicationDraftField) => {
        field.type = 'MULTI_SELECT';
        field.defaultValue = ['vip', 'missing'];
        field.config = { options: [{ key: 'vip', label: '重点客户' }] };
      },
    },
    {
      name: 'a SINGLE_SELECT default whose option is inactive',
      mutate: (field: PublicationDraftField) => {
        field.type = 'SINGLE_SELECT';
        field.defaultValue = 'vip';
        field.config = {
          options: [{ key: 'vip', label: '重点客户', status: 'INACTIVE' }],
        };
      },
    },
    {
      name: 'a TEXT default shorter than the configured minimum length',
      mutate: (field: PublicationDraftField) => {
        field.type = 'TEXT';
        field.defaultValue = 'ab';
        field.validation = { minLength: 3 };
      },
    },
    {
      name: 'a NUMBER default outside the configured range',
      mutate: (field: PublicationDraftField) => {
        field.type = 'NUMBER';
        field.defaultValue = 101;
        field.validation = { min: 0, max: 100 };
      },
    },
    {
      name: 'a MONEY default that is a JSON number instead of the engine string',
      mutate: (field: PublicationDraftField) => {
        field.type = 'MONEY';
        field.defaultValue = 12.5;
      },
    },
    {
      name: 'a MONEY default with more decimals than its scale',
      mutate: (field: PublicationDraftField) => {
        field.type = 'MONEY';
        field.defaultValue = '1.234';
        field.validation = { scale: 2 };
      },
    },
    {
      name: 'a DATE default that is not a real calendar date',
      mutate: (field: PublicationDraftField) => {
        field.type = 'DATE';
        field.defaultValue = '2024-02-31';
      },
    },
    {
      name: 'a DATETIME default without a time-zone offset',
      mutate: (field: PublicationDraftField) => {
        field.type = 'DATETIME';
        field.defaultValue = '2024-01-01T00:00:00';
      },
    },
    {
      name: 'a BOOLEAN default that is not a boolean',
      mutate: (field: PublicationDraftField) => {
        field.type = 'BOOLEAN';
        field.defaultValue = 'true';
      },
    },
  ])(
    'blocks a hidden required field whose default can never land: $name',
    ({ mutate }) => {
      const input = validObjectConfiguration();
      input.fields[1] = { ...input.fields[1], required: true };
      input.employeeAccess!.fields.email = 'HIDDEN';
      mutate(input.fields[1]);

      const blocker = analyzeObjectConfiguration(input).blocking.find(
        (issue) => issue.code === 'REQUIRED_FIELD_HIDDEN',
      );
      expect(blocker).toMatchObject({ fieldKey: 'email' });
      expect(blocker?.message).toContain('邮箱');
    },
  );

  // The mirror of the matrix above: every default the engine's `normalizeValue`
  // accepts must stay publishable, otherwise the new rule over-rejects.
  it.each([
    {
      name: 'TEXT',
      mutate: (field: PublicationDraftField) => {
        field.type = 'TEXT';
        field.defaultValue = '默认值';
      },
    },
    {
      name: 'PHONE',
      mutate: (field: PublicationDraftField) => {
        field.type = 'PHONE';
        field.defaultValue = '+8613900000000';
        field.validation = { country: 'CN', minLength: 8 };
      },
    },
    {
      name: 'TEXTAREA',
      mutate: (field: PublicationDraftField) => {
        field.type = 'TEXTAREA';
        field.defaultValue = '';
      },
    },
    {
      name: 'EMAIL',
      mutate: (field: PublicationDraftField) => {
        field.type = 'EMAIL';
        field.defaultValue = 'A@B.com';
      },
    },
    {
      name: 'SINGLE_SELECT',
      mutate: (field: PublicationDraftField) => {
        field.type = 'SINGLE_SELECT';
        field.defaultValue = 'vip';
        field.config = { options: [{ key: 'vip', label: '重点客户' }] };
      },
    },
    {
      name: 'MULTI_SELECT',
      mutate: (field: PublicationDraftField) => {
        field.type = 'MULTI_SELECT';
        field.defaultValue = ['vip'];
        field.config = { options: [{ key: 'vip', label: '重点客户' }] };
      },
    },
    {
      name: 'NUMBER',
      mutate: (field: PublicationDraftField) => {
        field.type = 'NUMBER';
        field.defaultValue = 12;
        field.validation = { min: 0, max: 100, scale: 0 };
      },
    },
    {
      name: 'MONEY',
      mutate: (field: PublicationDraftField) => {
        field.type = 'MONEY';
        field.defaultValue = '12.50';
        field.validation = { scale: 2 };
      },
    },
    {
      name: 'DATE',
      mutate: (field: PublicationDraftField) => {
        field.type = 'DATE';
        field.defaultValue = '2024-02-29';
      },
    },
    {
      name: 'DATETIME',
      mutate: (field: PublicationDraftField) => {
        field.type = 'DATETIME';
        field.defaultValue = '2024-01-01T00:00:00Z';
      },
    },
    {
      name: 'BOOLEAN',
      mutate: (field: PublicationDraftField) => {
        field.type = 'BOOLEAN';
        field.defaultValue = true;
      },
    },
  ])(
    'keeps accepting a hidden required field whose $name default still lands',
    ({ mutate }) => {
      const input = validObjectConfiguration();
      input.fields[1] = { ...input.fields[1], required: true };
      input.employeeAccess!.fields.email = 'HIDDEN';
      mutate(input.fields[1]);

      expect(
        analyzeObjectConfiguration(input).blocking.filter(
          (issue) => issue.code === 'REQUIRED_FIELD_HIDDEN',
        ),
      ).toEqual([]);
    },
  );

  it('treats a non-empty MEMBER default as materializable, because no database is reachable here', () => {
    const input = validObjectConfiguration();
    input.fields[1] = {
      ...input.fields[1],
      type: 'MEMBER',
      required: true,
      defaultValue: 'member-1',
      validation: {},
      config: {},
    };
    input.employeeAccess!.fields.email = 'HIDDEN';

    // The engine checks the id's shape and existence against the database on
    // every write, and `analyzeObjectConfiguration` runs before any such lookup,
    // so this rule cannot mirror it. Only a default that is not a non-empty
    // string is rejected; a stale-but-well-formed id is left to write time.
    expect(
      analyzeObjectConfiguration(input).blocking.filter(
        (issue) => issue.code === 'REQUIRED_FIELD_HIDDEN',
      ),
    ).toEqual([]);

    input.fields[1] = { ...input.fields[1], defaultValue: '' };
    expect(
      analyzeObjectConfiguration(input).blocking.find(
        (issue) => issue.code === 'REQUIRED_FIELD_HIDDEN',
      ),
    ).toMatchObject({ fieldKey: 'email' });
  });

  it('still accepts the untouched valid object configuration', () => {
    expect(
      analyzeObjectConfiguration(validObjectConfiguration()).blocking,
    ).toEqual([]);
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

  it('accepts supported select-option colors and rejects unknown colors', () => {
    const input = validObjectConfiguration();
    input.fields[1] = {
      ...input.fields[1],
      type: 'SINGLE_SELECT',
      config: {
        options: [{ key: 'vip', label: '重点客户', color: 'ORANGE' }],
      },
    };

    expect(
      analyzeObjectConfiguration(input).blocking.filter(
        (issue) => issue.fieldKey === 'email',
      ),
    ).toEqual([]);

    input.fields[1].config = {
      options: [{ key: 'vip', label: '重点客户', color: 'MAGENTA' }],
    };
    expect(analyzeObjectConfiguration(input).blocking).toContainEqual({
      code: 'FIELD_CONFIG_INVALID',
      message: '字段显示配置或选项结构不完整。',
      fieldKey: 'email',
    });
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
