import type { components } from "@crm/contracts";

type Schemas = components["schemas"];

export type BusinessTemplate = Schemas["BusinessTemplateSummaryResponseDto"];
export type BusinessTemplateDetail =
  Schemas["BusinessTemplateDetailResponseDto"];
export type BusinessTemplatePage = Schemas["BusinessTemplatePageResponseDto"];
export type BusinessTemplateVersion =
  Schemas["BusinessTemplateVersionResponseDto"];
export type TemplatePublicationAnalysis =
  Schemas["TemplatePublicationAnalysisResponseDto"];
export type TenantBusinessConfigurationSummary =
  Schemas["TenantBusinessConfigurationSummaryResponseDto"];
export type TemplateApplication = Schemas["TemplateApplicationResponseDto"];
export type CreateTemplateInput = Schemas["CreateBusinessTemplateDto"];
export type SaveTemplateDraftInput = Schemas["SaveBusinessTemplateDraftDto"];
export type ApplyTemplateInput = Schemas["ApplyBusinessTemplateDto"];
