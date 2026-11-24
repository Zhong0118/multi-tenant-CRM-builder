import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aiApi, aiQueryKeys } from "./ai-api";

export function useAssistantProposals(
  tenantCode: string,
  conversationId?: string | null,
) {
  const client = useQueryClient();
  const [proposalUpdates, setProposalUpdates] = useState<
    Record<string, import("./ai-types").AiProposalView>
  >({});
  const [proposalError, setProposalError] = useState<string | null>(null);
  const confirmProposal = useMutation({
    mutationFn: async (proposalId: string) => {
      const key = crypto.randomUUID();
      try {
        return await aiApi.confirmProposal(tenantCode, proposalId, key);
      } catch (error) {
        // A lost response is uncertain: reconcile first and never auto-repeat execution.
        const current = await aiApi.getProposal(tenantCode, proposalId);
        if (current.status === "PROPOSED") throw error;
        return current;
      }
    },
    onSuccess: (view) => {
      setProposalError(null);
      setProposalUpdates((current) => ({
        ...current,
        [view.proposalId]: view,
      }));
      if (conversationId)
        void client.invalidateQueries({
          queryKey: aiQueryKeys.messages(tenantCode, conversationId),
        });
    },
    onError: (error) =>
      setProposalError(
        error instanceof Error ? error.message : "提案执行失败，请稍后重试。",
      ),
  });
  const rejectProposal = useMutation({
    mutationFn: async (proposalId: string) => {
      try {
        return await aiApi.rejectProposal(tenantCode, proposalId);
      } catch (error) {
        const current = await aiApi.getProposal(tenantCode, proposalId);
        if (current.status === "PROPOSED") throw error;
        return current;
      }
    },
    onSuccess: (view) => {
      setProposalError(null);
      setProposalUpdates((current) => ({
        ...current,
        [view.proposalId]: view,
      }));
      if (conversationId)
        void client.invalidateQueries({
          queryKey: aiQueryKeys.messages(tenantCode, conversationId),
        });
    },
    onError: (error) =>
      setProposalError(
        error instanceof Error ? error.message : "提案拒绝失败，请稍后重试。",
      ),
  });
  return { proposalUpdates, proposalError, confirmProposal, rejectProposal };
}
