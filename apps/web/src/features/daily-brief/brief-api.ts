import { relationRequest } from "@/lib/api/relation-request";
export const attentionLabels = {
  reclaim: "快被收回",
  stagnant: "进展停滞",
  silent: "很久没联系",
} as const;
export type Attention = keyof typeof attentionLabels;
export interface BriefRecord {
  recordId: string;
  objectCode: string;
  objectName: string;
  title: string;
  keyDate: string;
  canFollowUp: boolean;
}
interface Group {
  key: Attention | "overdue";
  total: number;
  items: BriefRecord[];
  nextCursor: string | null;
}
export interface BriefList {
  memberId: string;
  localDate: string;
  timezone: string;
  groups: Group[];
}
export interface Suggestions {
  localDate: string;
  generatedAt: string | null;
  remaining: number;
  noValidatedSuggestions: boolean;
  busy: boolean;
  items: Array<
    Omit<BriefRecord, "keyDate"> & {
      overdueFollowUpId: string | null;
      reason: string;
      explanation: string;
      suggestedTitle: string;
      suggestedDue: string | null;
    }
  >;
}
export interface BriefRules {
  version: number;
  objectIds: string[] | null;
  contactDays: number;
  stagnantDays: number;
  reclaimDays: number;
}
const base = (tenant: string) =>
  "/api/v1/workspaces/" + encodeURIComponent(tenant) + "/daily-brief";
export const briefApi = {
  rules: (t: string) =>
    relationRequest<BriefRules & { objects: { id: string; name: string }[] }>(
      base(t) + "/settings",
    ),
  save: (t: string, rules: BriefRules) =>
    relationRequest<BriefRules>(base(t) + "/settings", "PUT", rules),
  list: (t: string, group?: Attention, cursor?: string) => {
    const query = new URLSearchParams();
    if (group) query.set("group", group);
    if (cursor) query.set("cursor", cursor);
    return relationRequest<BriefList>(
      base(t) + (query.size ? "?" + query : ""),
    );
  },
  suggestions: (t: string) =>
    relationRequest<Suggestions>(base(t) + "/suggestions"),
  generate: (t: string, previous: string | null, signal: AbortSignal) =>
    relationRequest<Suggestions>(
      base(t) + "/generate",
      "POST",
      { previous },
      signal,
    ),
};
