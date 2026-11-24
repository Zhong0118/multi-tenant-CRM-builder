export type ImportConfidence = "high" | "review";

export interface ImportPreviewColumn {
  /** Stable source position C1 through C40, including empty or duplicate headings. */
  col: string;
  header: string;
  /** Manual and rule mappings keep their target. Only unresolved values may receive advice. */
  locked?: { mode: "field" | "append"; field: string } | { mode: "owner" | "skip" };
  excluded?: boolean;
  samples: string[];
  values?: { id: string; text: string; count: number }[];
}

export interface ImportAssistRequest {
  sheet: string;
  currentHeader: number;
  headerLocked: boolean;
  /** CRM-only fingerprints of leading cells, by physical column, for restricted-heading detection. */
  headerEvidence: { col: string; hashes: string[]; rows?: number[] }[];
  /** All plausible physical header rows share a single model request. */
  candidates: { headerRow: number; columns: ImportPreviewColumn[] }[];
}

export interface ImportColumnAdvice {
  col: string;
  target: { mode: "field" | "append"; field: string } | { mode: "skip" };
  confidence: ImportConfidence;
  reason: string;
  dateOrder?: "DMY" | "MDY";
  bareAmountUnit?: "yuan" | "wan";
  values?: { value: string; option: string | null; confidence: ImportConfidence }[];
}

export interface ImportAssistPlan {
  version: 1;
  generatedAt: string;
  headerRow: number;
  columns: ImportColumnAdvice[];
  matchFields: string[];
}
