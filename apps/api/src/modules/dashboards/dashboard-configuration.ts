import type { PublishedField } from '../objects/object-schema';
import type {
  DashboardActivityConfiguration,
  DashboardConfiguration,
  DashboardConfigurationIssue,
  DashboardLeadConfiguration,
  DashboardOpportunityConfiguration,
  DashboardPublishedObject,
} from './dashboard.types';

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

export function parseDashboardConfiguration(
  value: unknown,
): DashboardConfiguration {
  try {
    const root = exactObject(value, ['opportunity', 'lead', 'activity']);
    return {
      opportunity: parseOpportunity(root.opportunity),
      ...(root.lead === undefined ? {} : { lead: parseLead(root.lead) }),
      ...(root.activity === undefined
        ? {}
        : { activity: parseActivity(root.activity) }),
    };
  } catch {
    throw new Error('Invalid dashboard configuration');
  }
}

export function validateDashboardConfiguration(
  configuration: DashboardConfiguration,
  publishedObjects: readonly DashboardPublishedObject[],
): DashboardConfigurationIssue[] {
  const issues: DashboardConfigurationIssue[] = [];
  const opportunity = publishedObjects.find(
    (item) => item.object.code === configuration.opportunity.objectCode,
  );
  if (!opportunity) {
    issues.push(
      issue(
        'OPPORTUNITY_OBJECT_NOT_FOUND',
        'opportunity.objectCode',
        '商机业务表不存在或尚未发布。',
      ),
    );
  } else {
    validateOpportunity(configuration.opportunity, opportunity, issues);
  }

  if (configuration.lead) {
    const lead = publishedObjects.find(
      (item) => item.object.code === configuration.lead?.objectCode,
    );
    if (!lead) {
      issues.push(
        issue(
          'LEAD_OBJECT_NOT_FOUND',
          'lead.objectCode',
          '线索业务表不存在或尚未发布。',
        ),
      );
    }
  }

  if (configuration.activity) {
    const activity = publishedObjects.find(
      (item) => item.object.code === configuration.activity?.objectCode,
    );
    if (!activity) {
      issues.push(
        issue(
          'ACTIVITY_OBJECT_NOT_FOUND',
          'activity.objectCode',
          '活动业务表不存在或尚未发布。',
        ),
      );
    } else {
      validateActivity(configuration.activity, activity, issues);
    }
  }

  return issues;
}

function parseOpportunity(value: unknown): DashboardOpportunityConfiguration {
  const input = exactObject(value, [
    'objectCode',
    'stageFieldKey',
    'amountFieldKey',
    'dateFieldKey',
    'activeOptionKeys',
    'wonOptionKeys',
    'lostOptionKeys',
  ]);
  return {
    objectCode: identifier(input.objectCode),
    stageFieldKey: identifier(input.stageFieldKey),
    ...(input.amountFieldKey === undefined
      ? {}
      : { amountFieldKey: identifier(input.amountFieldKey) }),
    ...(input.dateFieldKey === undefined
      ? {}
      : { dateFieldKey: identifier(input.dateFieldKey) }),
    activeOptionKeys: identifiers(input.activeOptionKeys),
    wonOptionKeys: identifiers(input.wonOptionKeys),
    lostOptionKeys: identifiers(input.lostOptionKeys),
  };
}

function parseLead(value: unknown): DashboardLeadConfiguration {
  const input = exactObject(value, ['objectCode', 'convertedOptionKeys']);
  return {
    objectCode: identifier(input.objectCode),
    ...(input.convertedOptionKeys === undefined
      ? {}
      : { convertedOptionKeys: identifiers(input.convertedOptionKeys) }),
  };
}

function parseActivity(value: unknown): DashboardActivityConfiguration {
  const input = exactObject(value, [
    'objectCode',
    'dueAtFieldKey',
    'statusFieldKey',
    'completedOptionKeys',
  ]);
  return {
    objectCode: identifier(input.objectCode),
    dueAtFieldKey: identifier(input.dueAtFieldKey),
    statusFieldKey: identifier(input.statusFieldKey),
    completedOptionKeys: identifiers(input.completedOptionKeys),
  };
}

function validateOpportunity(
  configuration: DashboardOpportunityConfiguration,
  object: DashboardPublishedObject,
  issues: DashboardConfigurationIssue[],
) {
  const stage = findField(object, configuration.stageFieldKey);
  if (!stage) {
    issues.push(
      issue(
        'STAGE_FIELD_NOT_FOUND',
        'opportunity.stageFieldKey',
        '阶段字段不存在于当前发布版本。',
      ),
    );
  } else if (stage.type !== 'SINGLE_SELECT') {
    issues.push(
      issue(
        'STAGE_FIELD_TYPE_INVALID',
        'opportunity.stageFieldKey',
        '阶段字段必须是单选字段。',
      ),
    );
  } else {
    const available = new Set(activeOptionKeys(stage));
    validateOptionGroup(
      configuration.activeOptionKeys,
      available,
      'opportunity.activeOptionKeys',
      issues,
    );
    validateOptionGroup(
      configuration.wonOptionKeys,
      available,
      'opportunity.wonOptionKeys',
      issues,
    );
    validateOptionGroup(
      configuration.lostOptionKeys,
      available,
      'opportunity.lostOptionKeys',
      issues,
    );
  }

  if (configuration.amountFieldKey) {
    const amount = findField(object, configuration.amountFieldKey);
    if (!amount) {
      issues.push(
        issue(
          'AMOUNT_FIELD_NOT_FOUND',
          'opportunity.amountFieldKey',
          '金额字段不存在于当前发布版本。',
        ),
      );
    } else if (amount.type !== 'NUMBER' && amount.type !== 'MONEY') {
      issues.push(
        issue(
          'AMOUNT_FIELD_TYPE_INVALID',
          'opportunity.amountFieldKey',
          '金额字段必须是数字或金额字段。',
        ),
      );
    }
  }

  if (configuration.dateFieldKey) {
    validateDateField(
      object,
      configuration.dateFieldKey,
      'opportunity.dateFieldKey',
      issues,
    );
  }
}

function validateActivity(
  configuration: DashboardActivityConfiguration,
  object: DashboardPublishedObject,
  issues: DashboardConfigurationIssue[],
) {
  validateDateField(
    object,
    configuration.dueAtFieldKey,
    'activity.dueAtFieldKey',
    issues,
  );
  const status = findField(object, configuration.statusFieldKey);
  if (!status) {
    issues.push(
      issue(
        'ACTIVITY_STATUS_FIELD_NOT_FOUND',
        'activity.statusFieldKey',
        '活动状态字段不存在于当前发布版本。',
      ),
    );
  } else if (status.type !== 'SINGLE_SELECT') {
    issues.push(
      issue(
        'ACTIVITY_STATUS_FIELD_TYPE_INVALID',
        'activity.statusFieldKey',
        '活动状态字段必须是单选字段。',
      ),
    );
  } else {
    validateOptionGroup(
      configuration.completedOptionKeys,
      new Set(activeOptionKeys(status)),
      'activity.completedOptionKeys',
      issues,
    );
  }
}

function validateDateField(
  object: DashboardPublishedObject,
  fieldKey: string,
  path: string,
  issues: DashboardConfigurationIssue[],
) {
  const field = findField(object, fieldKey);
  if (!field) {
    issues.push(issue('DATE_FIELD_NOT_FOUND', path, '日期字段不存在于当前发布版本。'));
  } else if (field.type !== 'DATE' && field.type !== 'DATETIME') {
    issues.push(issue('DATE_FIELD_TYPE_INVALID', path, '日期字段类型不兼容。'));
  }
}

function validateOptionGroup(
  keys: readonly string[],
  available: ReadonlySet<string>,
  path: string,
  issues: DashboardConfigurationIssue[],
) {
  for (const key of keys) {
    if (!available.has(key)) {
      issues.push(
        issue(
          'STAGE_OPTION_NOT_FOUND',
          path,
          `选项 ${key} 不存在或已停用。`,
        ),
      );
    }
  }
}

function findField(object: DashboardPublishedObject, fieldKey: string) {
  return object.fields.find((field) => field.fieldKey === fieldKey);
}

function activeOptionKeys(field: PublishedField): string[] {
  const raw = field.config.options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    const option = value as Record<string, unknown>;
    return typeof option.key === 'string' && option.status !== 'INACTIVE'
      ? [option.key]
      : [];
  });
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('object required');
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !allowedKeys.includes(key))) {
    throw new Error('unexpected key');
  }
  return object;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error('identifier required');
  }
  return value;
}

function identifiers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('non-empty identifier list required');
  }
  const parsed = value.map(identifier);
  if (new Set(parsed).size !== parsed.length) throw new Error('duplicate option');
  return parsed;
}

function issue(
  code: string,
  path: string,
  message: string,
): DashboardConfigurationIssue {
  return { code, path, message };
}
