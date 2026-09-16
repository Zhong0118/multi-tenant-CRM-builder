import { ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';

import { ApiException } from '../../../common/errors/api.exception';
import { validationFieldErrors } from '../../../common/errors/validation-field-errors';
import { validateWorkflowDraft } from '../workflow-draft.policy';
import { SaveWorkflowDraftDto } from './workflow.dto';

const METADATA: ArgumentMetadata = {
  type: 'body',
  metatype: SaveWorkflowDraftDto,
};

/** Mirrors the global pipe configured in apps/api/src/bootstrap.ts. */
function createPipe(): ValidationPipe {
  return new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
    exceptionFactory: (errors) =>
      new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: validationFieldErrors(errors),
      }),
  });
}

function payload(actions: unknown[]): Record<string, unknown> {
  return {
    expectedDraftRevision: 3,
    isEnabled: true,
    initialStateKey: 'new',
    states: [
      { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
      { key: 'won', label: '赢单', sortOrder: 20, isTerminal: true },
    ],
    transitions: [
      {
        key: 'mark-won',
        label: '标记赢单',
        fromStateKey: 'new',
        toStateKey: 'won',
        allowedRoles: ['TENANT_ADMIN'],
        requiredFieldKeys: [],
        sortOrder: 10,
        actions,
      },
    ],
  };
}

async function save(body: unknown): Promise<SaveWorkflowDraftDto> {
  // `transform()` is typed `Promise<any>`; the pipe returns the DTO it built.
  const dto = (await createPipe().transform(
    body,
    METADATA,
  )) as SaveWorkflowDraftDto;
  return dto;
}

async function rejection(body: unknown): Promise<ApiException> {
  try {
    await save(body);
  } catch (error) {
    if (error instanceof ApiException) return error;
    throw error;
  }
  throw new Error('expected the validation pipe to reject the payload');
}

describe('SaveWorkflowDraftDto action payloads', () => {
  it('accepts every declared action key shape', async () => {
    const actions = [
      {
        key: 'create-customer',
        type: 'CREATE_RECORD',
        targetObjectCode: 'customer',
        values: { name: { source: 'SOURCE_FIELD', fieldKey: 'companyName' } },
        owner: { source: 'ACTOR' },
      },
      {
        key: 'update-source',
        type: 'UPDATE_RECORD',
        target: 'SOURCE_RECORD',
        values: { note: { source: 'SOURCE_META', property: 'title' } },
      },
      {
        key: 'link-customer',
        type: 'CREATE_RELATION',
        left: { source: 'SOURCE_RECORD' },
        right: {
          source: 'ACTION_OUTPUT',
          actionKey: 'create-customer',
          property: 'recordId',
        },
      },
      {
        key: 'follow-up',
        type: 'CREATE_FOLLOW_UP',
        target: { source: 'SOURCE_RECORD' },
        title: { source: 'LITERAL', value: '首次回访' },
        dueAt: { source: 'NOW_PLUS_DAYS', days: 3 },
        assignee: { source: 'ACTOR' },
      },
      {
        key: 'assign-owner',
        type: 'ASSIGN_OWNER',
        target: 'SOURCE_RECORD',
        owner: { source: 'ACTOR' },
      },
    ];

    const dto = await save(payload(actions));

    expect(dto.transitions[0].actions).toEqual(actions);
  });

  it('rejects an undeclared action property', async () => {
    const error = await rejection(
      payload([
        {
          key: 'create-customer',
          type: 'CREATE_RECORD',
          targetObjectCode: 'customer',
          values: {},
          searchFilter: { fieldKey: 'phone' },
        },
      ]),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(error.fieldErrors)).toEqual([
      'transitions.0.actions.0.searchFilter',
    ]);
  });
});

/**
 * Every field declared on `WorkflowActionDraftDto`, in declaration order.
 *
 * `apps/api/tsconfig.json` targets ES2023, so `useDefineForClassFields` emits
 * each declared field as an own enumerable property: a transformed DTO
 * instance carries all of them even when the request body omitted the key, with
 * value `undefined`. Asserting the key set explicitly is what makes the seam
 * test below non-blind — `toEqual` skips `undefined`-valued properties, which is
 * exactly how the original suite missed the strict-allowlist bug. This
 * assertion is meant to fail if those class-field keys ever disappear or
 * reappear, so that the seam gets re-examined instead of silently drifting.
 */
const DTO_ACTION_OWN_KEYS = [
  'key',
  'type',
  'targetObjectCode',
  'values',
  'owner',
  'target',
  'left',
  'right',
  'title',
  'dueAt',
  'assignee',
];

/** Asserts `validateWorkflowDraft` rejects the transformed DTO. */
function draftFailure(dto: SaveWorkflowDraftDto): ApiException {
  try {
    validateWorkflowDraft(dto);
  } catch (error) {
    if (error instanceof ApiException) return error;
    throw error;
  }
  throw new Error('expected validateWorkflowDraft to reject the payload');
}

/**
 * The real HTTP path: `bootstrap.ts` ValidationPipe -> DTO instance ->
 * `WorkflowAdminService.save()` -> `validateWorkflowDraft()`. Unit tests that
 * hand the policy a plain object literal cannot see the class-instance
 * artifacts this seam produces.
 */
describe('SaveWorkflowDraftDto -> validateWorkflowDraft seam', () => {
  it('accepts a valid CREATE_RECORD action that came through the real pipe', async () => {
    const dto = await save(
      payload([
        {
          key: 'create-customer',
          type: 'CREATE_RECORD',
          targetObjectCode: 'customer',
          values: { name: { source: 'SOURCE_FIELD', fieldKey: 'companyName' } },
        },
      ]),
    );
    const action = dto.transitions[0].actions?.[0] as object;

    // The instance also carries `target`, `left`, `right`, `title`, `dueAt` and
    // `assignee` as `undefined`; the policy must ignore those artifacts rather
    // than treat them as undeclared configuration.
    expect(Object.keys(action)).toEqual(DTO_ACTION_OWN_KEYS);
    expect(validateWorkflowDraft(dto).transitions[0].actions).toEqual([
      {
        key: 'create-customer',
        type: 'CREATE_RECORD',
        targetObjectCode: 'customer',
        values: { name: { source: 'SOURCE_FIELD', fieldKey: 'companyName' } },
      },
    ]);
  });

  it('accepts a valid CREATE_FOLLOW_UP action, whose allowed key set differs', async () => {
    const action = {
      key: 'follow-up',
      type: 'CREATE_FOLLOW_UP',
      target: { source: 'SOURCE_RECORD' },
      title: { source: 'LITERAL', value: '首次回访' },
      dueAt: { source: 'NOW_PLUS_DAYS', days: 3 },
      assignee: { source: 'ACTOR' },
    };
    const dto = await save(payload([action]));

    expect(Object.keys(dto.transitions[0].actions?.[0] as object)).toEqual(
      DTO_ACTION_OWN_KEYS,
    );
    expect(validateWorkflowDraft(dto).transitions[0].actions).toEqual([action]);
  });

  it('still rejects a key the action type does not allow when it is defined', async () => {
    const dto = await save(
      payload([
        {
          key: 'create-customer',
          type: 'CREATE_RECORD',
          targetObjectCode: 'customer',
          values: {},
          // `target` is legitimate on UPDATE_RECORD/CREATE_FOLLOW_UP/ASSIGN_OWNER
          // but not on CREATE_RECORD: ignoring `undefined` must not weaken this.
          target: 'SOURCE_RECORD',
        },
      ]),
    );

    const error = draftFailure(dto);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(Object.keys(error.fieldErrors)).toEqual([
      'transitions.0.actions.0.target',
    ]);
  });
});
