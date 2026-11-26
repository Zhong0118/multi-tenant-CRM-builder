"use client";

import type { FieldErrors } from "@/lib/api/api-error";
import { createContext } from "react";
import type {
  AiProposalView,
  AssistantAction,
  AssistantAnswerValue,
  AssistantBatchConfirmation,
  AssistantBatchResult,
  AssistantPageHint,
  AssistantQuestion,
  FilterRule,
} from "@crm/contracts";

export interface AssistantPageContext {
  hint: AssistantPageHint;
  label: string;
  objectName?: string;
  listQuery?: string;
  filterDraft?: FilterRule;
  applyFilter?: (rule: FilterRule) => void;
  describeRule?: (rule: FilterRule) => string;
}
export interface AssistantCommands {
  busy: boolean;
  answer: (
    question: AssistantQuestion,
    value: AssistantAnswerValue,
  ) => Promise<FieldErrors | undefined> | undefined;
  cancel: (question: AssistantQuestion) => void;
  regenerate: (proposalId: string) => void;
  /** Asks the question of a turn again, for proposals that expired. */
  resend?: (turnId: string) => void;
  confirm: (
    turnId: string,
    input: AssistantBatchConfirmation,
  ) => Promise<AssistantBatchResult>;
  reject: (id: string) => Promise<AiProposalView>;
  apply: (
    action: Extract<AssistantAction, { kind: "filter" }>,
    rule: FilterRule,
  ) => "applied" | "review" | "stale";
  describeRule?: (rule: FilterRule) => string;
}
export const AssistantCommandContext = createContext<AssistantCommands | null>(
  null,
);
