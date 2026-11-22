import { Injectable } from '@nestjs/common';
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
  ) {}
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
          'Preview the user’s filter for this list. Copy the user description verbatim. Only the user can apply it.',
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
