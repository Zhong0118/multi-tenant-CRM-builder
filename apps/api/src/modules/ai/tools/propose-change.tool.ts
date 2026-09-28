import type { AiProviderTool } from '../ai-provider';
import {
  candidateSchema,
  validateProposalCandidate,
  type ProposalCandidate,
} from '../ai-proposal.schema';

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
      'Propose one change to one CRM record for human confirmation. This never executes a change.',
    inputSchema: candidateSchema,
    execute: async (input: unknown, callId: string) => {
      this.requested(callId);
      if (this.invalidated) {
        this.captured = null;
        return { accepted: false, code: 'MULTIPLE_PROPOSALS' };
      }
      try {
        this.captured = validateProposalCandidate(input);
        return { accepted: true, code: 'CANDIDATE_RECEIVED' };
      } catch {
        return { accepted: false, code: 'INVALID_PROPOSAL' };
      }
    },
  };
}
