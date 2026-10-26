import { randomUUID } from 'node:crypto';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type { PoolConfig } from '../records/record-ownership';
import type {
  BusinessTemplateConfiguration,
  TemplateGoalRule,
} from './business-template.schema';

export interface TemplateCaptureSource {
  tenant: { id: string; name: string; code: string };
  objects: Array<{
    schema: PublishedObjectSchema;
    pool: Omit<PoolConfig, 'version'>;
  }>;
  goalRules: TemplateGoalRule[];
  excluded: {
    unpublishedObjects: number;
    memberOverrides: number;
    selectedGoalRules: number;
  };
}

/** Prefer current draft identities, then the oldest matching published identity. */
export function captureTemplateConfiguration(
  source: TemplateCaptureSource,
  current: BusinessTemplateConfiguration,
  history: BusinessTemplateConfiguration[],
): BusinessTemplateConfiguration {
  const identities = [current, ...history];
  return {
    schemaVersion: 1,
    objects: source.objects.map(({ schema, pool }) => {
      const matches = identities.flatMap((version) =>
        version.objects.filter((o) => o.code === schema.object.code),
      );
      const id = matches[0]?.id ?? randomUUID();
      const workflow = schema.workflow;
      return {
        ...structuredClone(schema.object),
        id,
        status: 'ACTIVE' as const,
        fields: schema.fields.map((field) => ({
          ...structuredClone(field),
          id:
            matches
              .flatMap((o) => o.fields)
              .find((f) => f.fieldKey === field.fieldKey)?.id ?? randomUUID(),
          status: 'ACTIVE' as const,
        })),
        defaultView: structuredClone(schema.defaultView),
        employeeAccess: structuredClone(schema.employeeAccess),
        ...(workflow
          ? {
              workflow: {
                isEnabled: true,
                initialStateKey: workflow.initialStateKey,
                states: structuredClone(workflow.states),
                transitions: workflow.transitions.map((t, index) => ({
                  ...structuredClone(t),
                  sortOrder: index * 10,
                })),
              },
            }
          : {}),
        ...(schema.automations === undefined
          ? {}
          : { automations: structuredClone(schema.automations) }),
        pool: structuredClone(pool),
      };
    }),
    ...(current.dashboard === undefined
      ? {}
      : { dashboard: structuredClone(current.dashboard) }),
    goalRules: structuredClone(source.goalRules),
  };
}
