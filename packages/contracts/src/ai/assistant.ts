import type { FilterPreview, FilterRule } from "../records/index.js";
import type { AiProposalView } from "./stream.js";

export interface AssistantPageHint {
  objectCode: string;
  recordId?: string;
  viewId?: string;
}
export type AssistantQuestionStatus =
  "OPEN" | "ANSWERED" | "CANCELLED" | "SUPERSEDED" | "EXPIRED";
export interface AssistantChoice {
  id: string;
  label: string;
  summary?: string;
}
export interface AssistantField {
  key: string;
  label: string;
  type: string;
  options?: AssistantChoice[];
  requiredForAnswer?: boolean;
  value?: unknown;
}
export type AssistantAnswerValue =
  | { kind: "choose_record"; optionId: string }
  | { kind: "choose_option"; optionId: string; otherText?: never }
  | { kind: "choose_option"; otherText: string; optionId?: never }
  | { kind: "fill_fields"; values: Record<string, unknown> };
export type AssistantQuestion = {
  questionId: string;
  turnId: string;
  state: AssistantQuestionStatus;
  prompt: string;
  answer?: AssistantAnswerValue;
} & (
  | { kind: "choose_record"; options: AssistantChoice[] }
  | { kind: "choose_option"; options: AssistantChoice[] }
  | { kind: "fill_fields"; fields: AssistantField[] }
);
export type AssistantBatchItem = AiProposalView & {
  editableFields?: AssistantField[];
};
export interface AssistantBatch {
  items: AssistantBatchItem[];
  coverage?: { total: number; targets: number };
}
export type AssistantAction =
  | {
      kind: "communication";
      draftId: string;
      objectCode: string;
      recordId: string;
    }
  | {
      kind: "filter";
      objectCode: string;
      baseViewId?: string;
      currentRule: FilterRule;
      preview: FilterPreview;
    };
export interface AssistantBatchConfirmation {
  items: {
    proposalId: string;
    idempotencyKey: string;
    edits?: Record<string, unknown>;
  }[];
}
export interface AssistantBatchResult {
  items: {
    proposalId: string;
    status: AiProposalView["status"];
    message: string;
  }[];
}
