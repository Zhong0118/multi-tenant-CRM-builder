import { z } from 'zod';

import type { AiProviderTool } from '../ai-provider';
import {
  candidateSchema,
  validateProposalCandidate,
  type ProposalCandidate,
} from '../ai-proposal.schema';

const [update, followUp, note] = candidateSchema.options;
// Function APIs require an object at the root. The collector still applies the
// strict operation-specific candidate schema before accepting any intent.
const toolInput = z.strictObject({
  operationType: z.enum([
    'UPDATE_RECORD',
    'CREATE_FOLLOW_UP',
    'ADD_ACTIVITY_NOTE',
  ]),
  objectCode: update.shape.objectCode,
  recordId: update.shape.recordId,
  values: update.shape.values.optional(),
  title: followUp.shape.title.optional(),
  dueAt: followUp.shape.dueAt.optional(),
  content: note.shape.content.optional(),
});

// The provider tool only captures untrusted intent; domain validation and persistence
// happen after the provider finishes, in the orchestrator's tenant transaction.
export class ProposalCollector {
  private readonly callIds = new Set<string>();
  private captured: ProposalCandidate | null = null;

  requested(callId: string): void {
    this.callIds.add(callId);
    if (this.invalidated) this.captured = null;
  }

  get invalidated(): boolean {
    return this.callIds.size > 1;
  }
  get candidate(): ProposalCandidate | null {
    return this.invalidated ? null : this.captured;
  }

  readonly tool: AiProviderTool = {
    name: 'propose_change',
    description:
      'Propose one change to one CRM record for human confirmation. This never executes a change. UPDATE_RECORD requires values; CREATE_FOLLOW_UP requires title and dueAt; ADD_ACTIVITY_NOTE requires content. Only include fields for the selected operation.',
    inputSchema: toolInput,
    execute: (input: unknown, callId: string) => {
      this.requested(callId);
      if (this.invalidated) {
        this.captured = null;
        return Promise.resolve({ accepted: false, code: 'MULTIPLE_PROPOSALS' });
      }
      try {
        this.captured = validateProposalCandidate(input);
        return Promise.resolve({ accepted: true, code: 'CANDIDATE_RECEIVED' });
      } catch {
        return Promise.resolve({ accepted: false, code: 'INVALID_PROPOSAL' });
      }
    },
  };
}
