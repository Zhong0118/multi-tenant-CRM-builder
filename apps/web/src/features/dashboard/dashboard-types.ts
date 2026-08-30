import type { components } from "@crm/contracts";

export interface DashboardOpportunityConfiguration {
  objectCode: string;
  stageFieldKey: string;
  amountFieldKey?: string;
  dateFieldKey?: string;
  activeOptionKeys: string[];
  wonOptionKeys: string[];
  lostOptionKeys: string[];
}

export interface DashboardConfiguration {
  opportunity: DashboardOpportunityConfiguration;
}

export interface DashboardCandidateOption {
  key: string;
  label: string;
  color: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface DashboardCandidateField {
  fieldKey: string;
  label: string;
  type: string;
  config: { options?: DashboardCandidateOption[] };
}

export interface DashboardCandidate {
  object: { code: string; name: string };
  fields: DashboardCandidateField[];
}

export interface DashboardConfigurationView {
  record: {
    version: number;
    configuration: DashboardConfiguration;
    updatedAt: string;
  } | null;
  candidates: DashboardCandidate[];
  issues: components["schemas"]["DashboardConfigurationIssueDto"][];
}

export type DashboardOverview = components["schemas"]["DashboardOverviewDto"];

export function parseDashboardConfigurationView(
  value: components["schemas"]["DashboardConfigurationEnvelopeDto"],
): DashboardConfigurationView {
  return {
    record: value.record
      ? {
          version: value.record.version,
          updatedAt: value.record.updatedAt,
          configuration: parseConfiguration(value.record.configuration),
        }
      : null,
    candidates: value.candidates.map(parseCandidate),
    issues: value.issues,
  };
}

function parseConfiguration(value: unknown): DashboardConfiguration {
  const root = object(value);
  const opportunity = object(root.opportunity);
  return {
    opportunity: {
      objectCode: text(opportunity.objectCode),
      stageFieldKey: text(opportunity.stageFieldKey),
      ...(typeof opportunity.amountFieldKey === "string"
        ? { amountFieldKey: opportunity.amountFieldKey }
        : {}),
      ...(typeof opportunity.dateFieldKey === "string"
        ? { dateFieldKey: opportunity.dateFieldKey }
        : {}),
      activeOptionKeys: textArray(opportunity.activeOptionKeys),
      wonOptionKeys: textArray(opportunity.wonOptionKeys),
      lostOptionKeys: textArray(opportunity.lostOptionKeys),
    },
  };
}

function parseCandidate(value: unknown): DashboardCandidate {
  const root = object(value);
  const candidateObject = object(root.object);
  if (!Array.isArray(root.fields))
    throw new Error("Invalid dashboard candidate");
  return {
    object: {
      code: text(candidateObject.code),
      name: text(candidateObject.name),
    },
    fields: root.fields.map((value) => {
      const field = object(value);
      const config = object(field.config);
      return {
        fieldKey: text(field.fieldKey),
        label: text(field.label),
        type: text(field.type),
        config: {
          options: Array.isArray(config.options)
            ? config.options.map((value) => {
                const option = object(value);
                return {
                  key: text(option.key),
                  label: text(option.label),
                  color:
                    typeof option.color === "string" ? option.color : "GRAY",
                  status: option.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
                };
              })
            : undefined,
        },
      };
    }),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid dashboard response");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invalid dashboard response");
  }
  return value;
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Invalid dashboard response");
  }
  return value as string[];
}
