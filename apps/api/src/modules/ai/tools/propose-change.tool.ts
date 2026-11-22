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
  private readonly received = new Set<string>();
  private readonly items: ProposalCandidate[] = [];
  private failure:
    'PROPOSAL_LIMIT' | 'CONFLICTING_VALUES' | 'INVALID_PROPOSAL' | null = null;

  requested(callId: string): void {
    this.callIds.add(callId);
    if (this.callIds.size > 20) this.failure = 'PROPOSAL_LIMIT';
  }

  get failureCode() {
    return (
      this.failure ??
      (this.callIds.size !== this.received.size ? 'INVALID_PROPOSAL' : null)
    );
  }
  get invalidated() {
    return this.failureCode !== null;
  }
  get candidates(): ProposalCandidate[] {
    return this.invalidated ? [] : [...this.items];
  }
  get candidate() {
    return this.candidates[0] ?? null;
  }

  private collect(candidate: ProposalCandidate) {
    const previous =
      candidate.operationType === 'UPDATE_RECORD' &&
      this.items.find(
        (item) =>
          item.operationType === 'UPDATE_RECORD' &&
          item.recordId === candidate.recordId &&
          item.objectCode === candidate.objectCode,
      );
    if (
      previous &&
      previous.operationType === 'UPDATE_RECORD' &&
      candidate.operationType === 'UPDATE_RECORD'
    ) {
      for (const [key, value] of Object.entries(candidate.values)) {
        if (
          Object.hasOwn(previous.values, key) &&
          JSON.stringify(previous.values[key]) !== JSON.stringify(value)
        ) {
          this.failure = 'CONFLICTING_VALUES';
          return;
        }
      }
      previous.values = { ...previous.values, ...candidate.values };
    } else {
      this.items.push(candidate);
    }
  }

  readonly tool: AiProviderTool = {
    name: 'propose_change',
    description:
      'Propose one change to one CRM record for human confirmation. This never executes a change. UPDATE_RECORD requires values; CREATE_FOLLOW_UP requires title and dueAt; ADD_ACTIVITY_NOTE requires content. Only include fields for the selected operation.',
    inputSchema: toolInput,
    execute: (input: unknown, callId: string) => {
      this.requested(callId);
      if (!this.failure && !this.received.has(callId)) {
        this.received.add(callId);
        try {
          this.collect(validateProposalCandidate(input));
        } catch {
          this.failure = 'INVALID_PROPOSAL';
        }
      }
      return Promise.resolve(
        this.failure
          ? { accepted: false, code: this.failure }
          : { accepted: true, code: 'CANDIDATE_RECEIVED' },
      );
    },
  };
}
