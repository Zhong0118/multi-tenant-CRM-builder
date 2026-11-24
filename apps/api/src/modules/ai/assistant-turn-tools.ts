import { isAiGovernanceError } from './ai-governance-error';
import type {
  AiFeature,
  AiLedgerService,
} from './governance/ai-ledger.service';
import type { ApiException } from '../../common/errors/api.exception';
import type {
  AssistantQuestion,
  AssistantAction,
  FilterRule,
} from '@crm/contracts';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { BeginTurnResult } from './ai.types';
import type { AiToolCallbacks } from './ai-tool-wrapper';
import type { AiToolRegistry } from './tool-registry';
import type {
  AssistantQuestionsService,
  ResolvedAssistantPage,
} from './assistant-questions.service';
import type { AssistantActionsService } from './assistant-actions';
import { AssistantBrief } from './assistant-brief';
import { AssistantSearchEvidence } from './assistant-search-evidence';
import { ProposalCollector } from './tools/propose-change.tool';
import { createQuestionTools } from './tools/assistant-question.tool';

export async function createAssistantTurnTools(
  context: TenantContext,
  begun: BeginTurnResult,
  registry: AiToolRegistry,
  callbacks: AiToolCallbacks,
  stop: AbortController,
  options: {
    questions?: AssistantQuestionsService;
    actions?: AssistantActionsService;
    canPropose: boolean;
    ledger: AiLedgerService;
    features: AiFeature[];
    page?: ResolvedAssistantPage;
    filterDraft?: FilterRule;
    userText: string;
    filterChoice?: string;
    chosenRecord?: { objectCode: string; recordId: string };
  },
) {
  const { questions, actions, canPropose, page, filterDraft, userText } =
    options;
  const abortSignal = callbacks.abortSignal;
  const search = new AssistantSearchEvidence();
  const seen = new Set<string>();
  const targetKey = (ref: { objectCode: string; recordId: string }) =>
    ref.objectCode + '/' + ref.recordId;
  const brief = page?.recordId ? new AssistantBrief(page) : undefined;
  if (page?.recordId && questions) {
    const target = { objectCode: page.objectCode, recordId: page.recordId };
    await questions.remember(context, begun, [target], 'page');
    seen.add(targetKey(target));
  }

  const card: {
    question?: AssistantQuestion | null;
    action?: AssistantAction;
    denial?: ApiException;
  } = {};
  let cardRequested = false;
  async function present(create: () => Promise<void>) {
    if (cardRequested || abortSignal.aborted) return { accepted: false };
    cardRequested = true;
    try {
      await create();
      stop.abort();
      return { accepted: true };
    } catch (error) {
      cardRequested = false;
      throw error;
    }
  }
  const readCallbacks: AiToolCallbacks = {
    objectNames: page
      ? new Map([[page.objectCode, page.objectName]])
      : undefined,
    enrichSource: (name, args, source) => {
      if (
        !page?.recordId ||
        !args ||
        typeof args !== 'object' ||
        !('recordId' in args) ||
        args.recordId !== page.recordId ||
        source.objectCode !== page.objectCode
      )
        return;
      if (name === 'get_record' && source.kind === 'RECORDS') {
        source.briefKey = 'record';
        source.recordId = page.recordId;
      }
      if (source.kind === 'TIMELINE') {
        source.briefKey =
          name === 'list_activities' ? 'activities' : 'followups';
        source.recordId = page.recordId;
      }
    },
    afterRead: async (name, args, result) => {
      search.observe(name, args, result);
      brief?.observe(name, args, result);
      if (
        !args ||
        typeof args !== 'object' ||
        !('objectCode' in args) ||
        typeof args.objectCode !== 'string' ||
        !result ||
        typeof result !== 'object'
      )
        return;
      const rows =
        name === 'search_records' &&
        'items' in result &&
        Array.isArray(result.items)
          ? result.items
          : name === 'get_record'
            ? [result]
            : [];
      const objectCode = args.objectCode;
      const refs = rows.flatMap((row: unknown) =>
        row &&
        typeof row === 'object' &&
        'id' in row &&
        typeof row.id === 'string'
          ? [{ objectCode, recordId: row.id }]
          : [],
      );
      if (refs.length) {
        await questions?.remember(context, begun, refs, 'tool');
        for (const ref of refs) seen.add(targetKey(ref));
      }
    },
    ...callbacks,
    emit: (event) => {
      if (
        event.event === 'tool.failed' &&
        event.data.toolName === 'search_records'
      )
        search.invalidate();
      callbacks.emit(event);
    },
  };
  const collector = new ProposalCollector();
  const tools = registry.forActor(context, readCallbacks);
  let historicalTargets: Promise<Set<string>> | undefined;
  if (canPropose && options.features.includes('write_proposal'))
    tools.push({
      ...collector.tool,
      execute: async (raw, callId) => {
        collector.requested(callId);
        if (
          cardRequested ||
          abortSignal.aborted ||
          !raw ||
          typeof raw !== 'object' ||
          !('objectCode' in raw) ||
          typeof raw.objectCode !== 'string' ||
          !('recordId' in raw) ||
          typeof raw.recordId !== 'string'
        )
          return { accepted: false };
        const key = targetKey({
          objectCode: raw.objectCode,
          recordId: raw.recordId,
        });
        if (!seen.has(key)) {
          historicalTargets ??= (
            questions?.seen(context, begun.conversationId) ??
            Promise.resolve([])
          ).then((refs) => new Set(refs.map(targetKey)));
          if (!(await historicalTargets).has(key))
            return { accepted: false, code: 'TARGET_UNAVAILABLE' };
        }
        return collector.tool.execute(raw, callId);
      },
    });

  if (options.features.includes('writing')) {
    const tool = actions?.writingTool?.(
      context,
      userText,
      abortSignal,
      (objectCode, recordId) => {
        const ref = { objectCode, recordId };
        return (
          (page?.objectCode === objectCode && page.recordId === recordId) ||
          (options.chosenRecord?.objectCode === objectCode &&
            options.chosenRecord.recordId === recordId) ||
          search.coverage([ref])?.total === 1
        );
      },
    );
    if (tool)
      tools.push({
        ...tool,
        execute: (input) =>
          present(async () => {
            card.action = await tool.execute(input);
          }),
      });
  }
  if (questions)
    tools.push(
      ...createQuestionTools((input) =>
        present(async () => {
          card.question = await questions.open(
            context,
            begun,
            input,
            page,
            filterDraft,
          );
        }),
      ),
    );
  for (const tool of actions?.forPage(
    context,
    page,
    begun.turnId,
    userText,
    filterDraft,
    options.filterChoice,
  ) ?? []) {
    if (
      !options.features.includes(
        tool.name === 'draft_communication' ? 'communication' : 'filter',
      )
    )
      continue;
    tools.push({
      ...tool,
      execute: (input, id) =>
        present(async () => {
          card.action = (await tool.execute(input, id)) as AssistantAction;
        }),
    });
  }
  if (brief)
    tools.push({
      ...brief.tool,
      execute: (input, id) =>
        present(async () => {
          await brief.tool.execute(input, id);
        }),
    });
  const guardedTools = tools.map((tool) => ({
    ...tool,
    async execute(input: unknown, id: string) {
      try {
        await options.ledger.assertFeature(context, 'assistant');
        if (tool.name === 'propose_change')
          await options.ledger.assertFeature(context, 'write_proposal');
        // The specialist services check their own feature after resource authorization.
        return await tool.execute(input, id);
      } catch (error) {
        if (isAiGovernanceError(error)) {
          // SDKs may turn a thrown tool error into a normal result and request another step.
          card.denial = error;
          stop.abort();
        }
        throw error;
      }
    },
  }));
  return { tools: guardedTools, collector, search, card, brief };
}

/** Saved history can regenerate a draft; the generated text only travels on the live stream. */
export function persistedAction(action: AssistantAction) {
  if (action.kind !== 'writing') return action;
  const { kind, objectCode, recordId, options } = action;
  return {
    kind,
    objectCode,
    recordId,
    options: {
      kind: options.kind,
      tone: options.tone,
      purpose: options.purpose,
      length: options.length,
    },
  };
}
