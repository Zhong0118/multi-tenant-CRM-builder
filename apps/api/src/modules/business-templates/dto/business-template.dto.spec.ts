import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { SaveBusinessTemplateDraftDto } from './business-template.dto';

describe('business template DTOs', () => {
  it.each([
    ['description', (input: DraftInput) => delete input.description],
    [
      'configuration.objects.0.description',
      (input: DraftInput) => delete input.configuration.objects[0].description,
    ],
    [
      'configuration.objects.0.icon',
      (input: DraftInput) => delete input.configuration.objects[0].icon,
    ],
    [
      'configuration.objects.0.defaultView',
      (input: DraftInput) => delete input.configuration.objects[0].defaultView,
    ],
    [
      'configuration.objects.0.employeeAccess',
      (input: DraftInput) =>
        delete input.configuration.objects[0].employeeAccess,
    ],
  ])('rejects an omitted required nullable field at %s', async (path, omit) => {
    const input = validDraftInput();
    omit(input);

    const errors = await validate(
      plainToInstance(SaveBusinessTemplateDraftDto, input),
    );

    expect(errorPaths(errors)).toContain(path);
  });

  it('accepts explicit null for every nullable draft field', async () => {
    const input = validDraftInput();
    input.configuration.objects[0].defaultView = null;
    input.configuration.objects[0].employeeAccess = null;

    await expect(
      validate(plainToInstance(SaveBusinessTemplateDraftDto, input)),
    ).resolves.toEqual([]);
  });

  it('rejects employee field access outside the supported values', async () => {
    const input = validDraftInput();
    input.configuration.objects[0].employeeAccess!.fields.name = 'ADMIN';

    const errors = await validate(
      plainToInstance(SaveBusinessTemplateDraftDto, input),
    );

    expect(errorPaths(errors)).toContain(
      'configuration.objects.0.employeeAccess.fields',
    );
  });
});

type DraftInput = ReturnType<typeof validDraftInput>;

function validDraftInput() {
  return {
    expectedVersion: 1,
    name: '销售模板',
    description: null as string | null | undefined,
    configuration: {
      schemaVersion: 1,
      objects: [
        {
          id: '01991b65-6400-7000-8000-000000000001',
          code: 'leads',
          name: '销售线索',
          description: null as string | null | undefined,
          icon: null as string | null | undefined,
          titleFieldKey: 'name',
          sortOrder: 10,
          status: 'ACTIVE',
          fields: [
            {
              id: '01991b65-6400-7000-8000-000000000002',
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
          ],
          defaultView: {
            code: 'default',
            name: '全部线索',
            columnFieldKeys: ['name'],
            sort: { field: 'updatedAt', direction: 'desc' },
          } as
            | {
                code: string;
                name: string;
                columnFieldKeys: string[];
                sort: { field: string; direction: string };
              }
            | null
            | undefined,
          employeeAccess: {
            canCreate: true,
            canRead: true,
            canUpdate: true,
            canDelete: false,
            readScope: 'ALL',
            updateScope: 'OWN',
            fields: { name: 'EDIT' } as Record<string, string>,
          } as
            | {
                canCreate: boolean;
                canRead: boolean;
                canUpdate: boolean;
                canDelete: boolean;
                readScope: string;
                updateScope: string;
                fields: Record<string, string>;
              }
            | null
            | undefined,
        },
      ],
    },
  };
}

function errorPaths(
  errors: ValidationError[],
  parent = '',
): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    return [
      ...(error.constraints ? [path] : []),
      ...errorPaths(error.children ?? [], path),
    ];
  });
}
