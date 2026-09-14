"use client";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import {
  parseRuntimeObjectSchema,
  type CreateFieldInput,
  type CreateObjectInput,
  type DefaultViewInput,
  type EmployeePermissionsInput,
  type ObjectDraft,
  type ObjectPublication,
  type PublicationAnalysis,
  type RuntimeObjectNavigation,
  type RuntimeObjectSchema,
  type UpdateFieldInput,
  type UpdateObjectInput,
} from "./object-types";

export interface ObjectApi {
  /** Runtime navigation and schema, available to every member. */
  listAccessible(tenantCode: string): Promise<RuntimeObjectNavigation[]>;
  runtimeSchema(
    tenantCode: string,
    objectCode: string,
  ): Promise<RuntimeObjectSchema>;

  /** Configuration, restricted to tenant administrators by the API. */
  listDrafts(tenantCode: string): Promise<ObjectDraft[]>;
  draft(tenantCode: string, objectId: string): Promise<ObjectDraft>;
  createDraft(
    tenantCode: string,
    input: CreateObjectInput,
  ): Promise<ObjectDraft>;
  updateDraft(
    tenantCode: string,
    objectId: string,
    input: UpdateObjectInput,
  ): Promise<ObjectDraft>;
  reorderObjects(
    tenantCode: string,
    items: Array<{ objectId: string; expectedVersion: number }>,
  ): Promise<ObjectDraft[]>;
  createField(
    tenantCode: string,
    objectId: string,
    input: CreateFieldInput,
  ): Promise<ObjectDraft>;
  updateField(
    tenantCode: string,
    objectId: string,
    fieldId: string,
    input: UpdateFieldInput,
  ): Promise<ObjectDraft>;
  reorderFields(
    tenantCode: string,
    objectId: string,
    input: { expectedVersion: number; fieldIds: string[] },
  ): Promise<ObjectDraft>;
  updateDefaultView(
    tenantCode: string,
    objectId: string,
    input: DefaultViewInput,
  ): Promise<ObjectDraft>;
  updatePermissions(
    tenantCode: string,
    objectId: string,
    input: EmployeePermissionsInput,
  ): Promise<ObjectDraft>;
  analyzePublication(
    tenantCode: string,
    objectId: string,
    expectedVersion: number,
  ): Promise<PublicationAnalysis>;
  publish(
    tenantCode: string,
    objectId: string,
    expectedVersion: number,
  ): Promise<ObjectPublication>;
  listPublications(
    tenantCode: string,
    objectId: string,
  ): Promise<ObjectPublication[]>;
  archive(
    tenantCode: string,
    objectId: string,
    expectedVersion: number,
  ): Promise<ObjectDraft>;
  removeDraft(
    tenantCode: string,
    objectId: string,
    expectedVersion: number,
  ): Promise<{ deleted: true }>;
}

export async function dataOrThrow<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}

const DEFINITIONS = "/api/v1/workspaces/{tenantCode}/object-definitions";
const DEFINITION = `${DEFINITIONS}/{objectId}` as const;

export const objectApi: ObjectApi = {
  async listAccessible(tenantCode) {
    return dataOrThrow(
      await browserApiClient.GET("/api/v1/workspaces/{tenantCode}/objects", {
        params: { path: { tenantCode } },
      }),
    );
  },
  async runtimeSchema(tenantCode, objectCode) {
    return parseRuntimeObjectSchema(
      await dataOrThrow(
        await browserApiClient.GET(
          "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/schema",
          { params: { path: { tenantCode, objectCode } } },
        ),
      ),
    );
  },

  async listDrafts(tenantCode) {
    return dataOrThrow(
      await browserApiClient.GET(DEFINITIONS, {
        params: { path: { tenantCode } },
      }),
    );
  },
  async draft(tenantCode, objectId) {
    return dataOrThrow(
      await browserApiClient.GET(DEFINITION, {
        params: { path: { tenantCode, objectId } },
      }),
    );
  },
  async createDraft(tenantCode, input) {
    return dataOrThrow(
      await browserApiClient.POST(DEFINITIONS, {
        params: { path: { tenantCode } },
        body: input,
      }),
    );
  },
  async updateDraft(tenantCode, objectId, input) {
    return dataOrThrow(
      await browserApiClient.PATCH(DEFINITION, {
        params: { path: { tenantCode, objectId } },
        body: input,
      }),
    );
  },
  async reorderObjects(tenantCode, items) {
    return dataOrThrow(
      await browserApiClient.PUT(`${DEFINITIONS}/order`, {
        params: { path: { tenantCode } },
        body: { items },
      }),
    );
  },
  async createField(tenantCode, objectId, input) {
    return dataOrThrow(
      await browserApiClient.POST(`${DEFINITION}/fields`, {
        params: { path: { tenantCode, objectId } },
        body: input,
      }),
    );
  },
  async updateField(tenantCode, objectId, fieldId, input) {
    return dataOrThrow(
      await browserApiClient.PATCH(`${DEFINITION}/fields/{fieldId}`, {
        params: { path: { tenantCode, objectId, fieldId } },
        body: input,
      }),
    );
  },
  async reorderFields(tenantCode, objectId, input) {
    return dataOrThrow(
      await browserApiClient.PUT(`${DEFINITION}/field-order`, {
        params: { path: { tenantCode, objectId } },
        body: input,
      }),
    );
  },
  async updateDefaultView(tenantCode, objectId, input) {
    return dataOrThrow(
      await browserApiClient.PUT(`${DEFINITION}/default-view`, {
        params: { path: { tenantCode, objectId } },
        body: input,
      }),
    );
  },
  async updatePermissions(tenantCode, objectId, input) {
    return dataOrThrow(
      await browserApiClient.PUT(`${DEFINITION}/permissions`, {
        params: { path: { tenantCode, objectId } },
        body: input,
      }),
    );
  },
  async analyzePublication(tenantCode, objectId, expectedVersion) {
    return dataOrThrow(
      await browserApiClient.POST(`${DEFINITION}/publication-analysis`, {
        params: { path: { tenantCode, objectId } },
        body: { expectedVersion },
      }),
    );
  },
  async publish(tenantCode, objectId, expectedVersion) {
    return dataOrThrow(
      await browserApiClient.POST(`${DEFINITION}/publications`, {
        params: { path: { tenantCode, objectId } },
        body: { expectedVersion },
      }),
    );
  },
  async listPublications(tenantCode, objectId) {
    return dataOrThrow(
      await browserApiClient.GET(`${DEFINITION}/publications`, {
        params: { path: { tenantCode, objectId } },
      }),
    );
  },
  async archive(tenantCode, objectId, expectedVersion) {
    return dataOrThrow(
      await browserApiClient.POST(`${DEFINITION}/archive`, {
        params: { path: { tenantCode, objectId } },
        body: { expectedVersion },
      }),
    );
  },
  async removeDraft(tenantCode, objectId, expectedVersion) {
    return dataOrThrow(
      await browserApiClient.DELETE(DEFINITION, {
        params: { path: { tenantCode, objectId } },
        body: { expectedVersion },
      }),
    );
  },
};
