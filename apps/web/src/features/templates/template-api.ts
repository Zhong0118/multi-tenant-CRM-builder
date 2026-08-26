"use client";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import type {
  ApplyTemplateInput,
  BusinessTemplateDetail,
  BusinessTemplatePage,
  BusinessTemplateVersion,
  CreateTemplateInput,
  SaveTemplateDraftInput,
  TemplateApplication,
  TemplatePublicationAnalysis,
} from "./template-types";

export interface TemplateListQuery {
  page: number;
  limit: number;
  hasActiveVersion?: boolean;
}

export interface TemplateApi {
  list(query: TemplateListQuery): Promise<BusinessTemplatePage>;
  create(input: CreateTemplateInput): Promise<BusinessTemplateDetail>;
  detail(templateId: string): Promise<BusinessTemplateDetail>;
  saveDraft(
    templateId: string,
    input: SaveTemplateDraftInput,
  ): Promise<BusinessTemplateDetail>;
  analyzePublication(
    templateId: string,
    expectedVersion: number,
  ): Promise<TemplatePublicationAnalysis>;
  publish(
    templateId: string,
    expectedVersion: number,
  ): Promise<BusinessTemplateVersion>;
  listVersions(templateId: string): Promise<BusinessTemplateVersion[]>;
  apply(templateId: string, input: ApplyTemplateInput): Promise<TemplateApplication>;
}

const TEMPLATES = "/api/v1/platform/business-templates" as const;
const TEMPLATE = `${TEMPLATES}/{templateId}` as const;

export const browserTemplateApi: TemplateApi = {
  async list(query) {
    return dataOrThrow(
      await browserApiClient.GET(TEMPLATES, {
        params: { query: definedEntries(query) },
      }),
    );
  },
  async create(input) {
    return dataOrThrow(await browserApiClient.POST(TEMPLATES, { body: input }));
  },
  async detail(templateId) {
    return dataOrThrow(
      await browserApiClient.GET(TEMPLATE, {
        params: { path: { templateId } },
      }),
    );
  },
  async saveDraft(templateId, input) {
    return dataOrThrow(
      await browserApiClient.PUT(`${TEMPLATE}/draft`, {
        params: { path: { templateId } },
        body: input,
      }),
    );
  },
  async analyzePublication(templateId, expectedVersion) {
    return dataOrThrow(
      await browserApiClient.POST(`${TEMPLATE}/publication-analysis`, {
        params: { path: { templateId } },
        body: { expectedVersion },
      }),
    );
  },
  async publish(templateId, expectedVersion) {
    return dataOrThrow(
      await browserApiClient.POST(`${TEMPLATE}/versions`, {
        params: { path: { templateId } },
        body: { expectedVersion },
      }),
    );
  },
  async listVersions(templateId) {
    return dataOrThrow(
      await browserApiClient.GET(`${TEMPLATE}/versions`, {
        params: { path: { templateId } },
      }),
    );
  },
  async apply(templateId, input) {
    return dataOrThrow(
      await browserApiClient.POST(`${TEMPLATE}/applications`, {
        params: { path: { templateId } },
        body: input,
      }),
    );
  },
};

/** Supplies browser defaults while making feature tests override only one call. */
export function templateApi(overrides: Partial<TemplateApi> = {}): TemplateApi {
  return { ...browserTemplateApi, ...overrides };
}

async function dataOrThrow<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}

function definedEntries<T extends object>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
