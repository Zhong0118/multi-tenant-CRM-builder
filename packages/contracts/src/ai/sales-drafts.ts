export type WritingOptions = {
  kind: "message" | "email" | "call" | "visit";
  purpose: "followup" | "invite" | "quote" | "payment" | "thanks" | "other";
  tone: "formal" | "friendly";
  length: "short" | "medium";
  supplement?: string;
};
export interface WritingDraft {
  kind: WritingOptions["kind"];
  subject?: string;
  missingTopics?: string[];
  blocks: { text: string; factRefs: string[] }[];
}
export type DailyReportSections = Record<"plans" | "completed" | "problems" | "nextSteps", string>;
