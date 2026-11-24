import { SalesDraftsService } from './sales-drafts.service';
import { writingOptions } from './sales-draft-output';
import { Injectable, Optional } from '@nestjs/common';
import type {
  AssistantAction,
  AssistantPageHint,
  FilterRule,
} from '@crm/contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AiProviderTool } from './ai-provider';
import { CommunicationDraftsService } from './communication-drafts.service';
import { FilterPreviewService } from './filter-preview.service';

const textInput = z.strictObject({ text: z.string().trim().min(1).max(4000) });
@Injectable()
export class AssistantActionsService {
  constructor(
    private readonly drafts: CommunicationDraftsService,
    private readonly filters: FilterPreviewService,
    @Optional() private readonly sales?: SalesDraftsService,
  ) {}
  writingTool(
    actor: TenantContext,
    userText: string,
    signal: AbortSignal,
    authorized: (code: string, id: string) => boolean,
  ) {
    const sales = this.sales;
    if (!sales) return;
    const schema = z.strictObject({
      objectCode: z.string().min(1).max(64),
      recordId: z.uuid(),
      options: writingOptions,
    });
    return {
      name: 'draft_writing',
      description:
        'Use this tool for outbound message/email/call outline/visit preparation. Use the current verified record or search for the named record. With multiple matches ask_user choose_record before drafting. Include only verbatim user-supplied business details as supplement. Never compose the draft yourself.',
      inputSchema: schema,
      execute: async (raw: unknown): Promise<AssistantAction> => {
        const { objectCode, recordId, options } = schema.parse(raw);
        if (
          !authorized(objectCode, recordId) ||
          (options.supplement && !userText.includes(options.supplement))
        )
          throw new ApiException('VALIDATION_FAILED', 400);
        const draft = await sales.write(
          actor,
          objectCode,
          recordId,
          options,
          signal,
        );
        return { kind: 'writing', objectCode, recordId, options, draft };
      },
    };
  }
  forPage(
    actor: TenantContext,
    page: AssistantPageHint | undefined,
    turnId: string,
    userText: string,
    filterDraft: FilterRule | undefined,
    filterChoice?: string,
  ): (AiProviderTool & {
    execute(input: unknown, id: string): Promise<AssistantAction>;
  })[] {
    if (!page) return [];
    const { objectCode, recordId, viewId } = page;
    function quoted(input: unknown, selectedChoice?: string) {
      const { text } = textInput.parse(input);
      if (!userText.includes(text) && text !== selectedChoice)
        throw new ApiException('VALIDATION_FAILED', 400);
      return text;
    }
    if (recordId)
      return [
        {
          name: 'draft_communication',
          description:
            'Prepare the communication draft for the current record. Copy the user’s own communication notes verbatim; if notes are missing, ask first.',
          inputSchema: textInput,
          execute: async (input) => {
            const draft = await this.drafts.create(
              actor,
              objectCode,
              recordId,
              { requestId: turnId, text: quoted(input) },
            );
            return {
              kind: 'communication',
              draftId: draft.id,
              objectCode,
              recordId,
            };
          },
        },
      ];
    const currentRule = filterDraft ?? {
      version: 1,
      match: 'all',
      conditions: [],
    };
    return [
      {
        name: 'preview_filter',
        description:
          'First tool for finding, filtering or listing matching records in the current table (找、筛选、列出). Pass the user’s request verbatim. The filter service resolves fields and criteria; only the user can apply the preview.',
        inputSchema: textInput,
        execute: async (input) => {
          const preview = await this.filters.preview(actor, objectCode, {
            text: quoted(input, filterChoice),
            currentRule,
            baseViewId: viewId,
          });
          return {
            kind: 'filter',
            objectCode,
            baseViewId: viewId,
            currentRule,
            preview,
          };
        },
      },
    ];
  }
}
