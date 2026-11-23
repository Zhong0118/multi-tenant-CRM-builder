import type { AiMessage, AiProposalView } from "./ai-types";
import { toAssistantMessage, type AiTurnState } from "./ai-turn-reducer";

export function assistantHistory(
  fullHistory: AiMessage[],
  retriedRow: { turnId: string; fingerprint: string } | null,
  state: AiTurnState,
  proposalUpdates: Record<string, AiProposalView>,
) {
  const history = retriedRow
    ? fullHistory.filter(
        (item) =>
          !(
            item.role === "ASSISTANT" &&
            item.turnId === retriedRow.turnId &&
            rowFingerprint(item) === retriedRow.fingerprint
          ),
      )
    : fullHistory;
  const liveMessage = toAssistantMessage(state);
  // Once an authoritative server row exists for the finished turn, discard
  // the SSE snapshot; permission revocation may have redacted its Proposal.
  // A GENERATING row is only a placeholder, so the live stream stays visible.
  const live =
    liveMessage &&
    history.some(
      (item) =>
        item.role === "ASSISTANT" &&
        item.turnId === liveMessage.turnId &&
        item.status !== "GENERATING",
    )
      ? null
      : liveMessage;
  const historyHasPendingUser =
    !!state.turnId &&
    history.some(
      (item) => item.role === "USER" && item.turnId === state.turnId,
    );
  const pendingUser: AiMessage | null =
    state.pendingUserContent && state.conversationId
      ? {
          id: `pending-${state.turnId ?? "new"}`,
          conversationId: state.conversationId,
          turnId: state.turnId ?? "pending",
          role: "USER",
          status: "COMPLETED",
          content: state.pendingUserContent,
          toolSummary: [],
          sourceSummary: [],
          createdAt: new Date().toISOString(),
        }
      : state.pendingUserContent
        ? {
            id: "pending-new",
            conversationId: "pending",
            turnId: "pending",
            role: "USER",
            status: "COMPLETED",
            content: state.pendingUserContent,
            toolSummary: [],
            sourceSummary: [],
            createdAt: new Date().toISOString(),
          }
        : null;
  // The persisted question keeps its place in history; the optimistic copy is
  // only shown until the server row arrives, so the answer always follows it.
  return [
    ...history.filter(
      (item) => !(live && item.turnId === live.turnId && item.role !== "USER"),
    ),
    ...(pendingUser && !historyHasPendingUser ? [pendingUser] : []),
    ...(live ? [live] : []),
  ].map((item) => {
    const update = item.proposal
      ? proposalUpdates[item.proposal.proposalId]
      : undefined;
    if (!update || item.proposal?.status !== "PROPOSED") return item;
    return {
      ...item,
      proposal: {
        ...update,
        // The server projection remains authoritative for permission-sensitive data.
        targetSummary: item.proposal?.targetSummary ?? "",
        changes: item.proposal?.changes ?? [],
        result: item.proposal?.result ?? null,
        fieldErrors: update.fieldErrors ?? {},
      },
    };
  });
}

export function rowFingerprint(item: AiMessage) {
  return [
    item.status,
    item.completedAt ?? "",
    item.errorCode ?? "",
    item.content,
    JSON.stringify(item.questions ?? []),
  ].join("\u0000");
}
