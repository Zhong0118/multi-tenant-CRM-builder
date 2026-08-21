import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the first account and workspace routes", async () => {
  const document = JSON.parse(
    await readFile(new URL("./openapi.json", import.meta.url), "utf8"),
  );

  assert.ok(document.paths["/api/v1/auth/register"]);
  assert.ok(document.paths["/api/v1/me/invitations/{invitationId}"]);
  assert.ok(document.paths["/api/v1/workspaces/{tenantCode}/members"]);

  assert.deepEqual(
    document.components.schemas.RegisterDto.required.toSorted(),
    ["code", "deviceSummary", "displayName", "password", "phone"],
  );
  assert.equal(
    document.components.schemas.RegisterDto.properties.password.minLength,
    10,
  );
  assert.equal(
    document.components.schemas.RegisterDto.properties.password.maxLength,
    72,
  );
  assert.equal(
    document.components.schemas.RegisterDto.properties.password.pattern,
    "^(?=.*[A-Za-z])(?=.*\\d)[\\s\\S]*$",
  );

  const workspaceOperation =
    document.paths["/api/v1/workspaces/{tenantCode}/members"].get;
  assert.ok(
    workspaceOperation.parameters.some(
      (parameter) =>
        parameter.in === "path" &&
        parameter.name === "tenantCode" &&
        parameter.required === true,
    ),
  );
  for (const name of ["page", "limit"]) {
    assert.ok(
      workspaceOperation.parameters.some(
        (parameter) =>
          parameter.in === "query" &&
          parameter.name === name &&
          parameter.schema.type === "number",
      ),
    );
  }
  assert.deepEqual(
    workspaceOperation.responses["200"].content["application/json"].schema,
    { $ref: "#/components/schemas/TenantMemberPageResponseDto" },
  );

  const tenantList = document.paths["/api/v1/platform/tenants"].get;
  for (const name of ["page", "limit"]) {
    assert.ok(
      tenantList.parameters.some(
        (parameter) =>
          parameter.in === "query" &&
          parameter.name === name &&
          parameter.schema.type === "number",
      ),
    );
  }
  assert.deepEqual(
    tenantList.responses["200"].content["application/json"].schema,
    { $ref: "#/components/schemas/PlatformTenantPageResponseDto" },
  );

  const invitationList =
    document.paths["/api/v1/workspaces/{tenantCode}/invitations"].get;
  assert.ok(
    invitationList.parameters.some(
      (parameter) => parameter.in === "query" && parameter.name === "limit",
    ),
  );
  assert.deepEqual(
    invitationList.responses["200"].content["application/json"].schema,
    {
      $ref: "#/components/schemas/InvitationPageResponseDto",
    },
  );

  assert.deepEqual(
    document.paths["/api/v1/me/workspaces"].get.responses["200"].content[
      "application/json"
    ].schema,
    {
      items: { $ref: "#/components/schemas/WorkspaceSummaryResponseDto" },
      type: "array",
    },
  );

  assert.deepEqual(document.components.securitySchemes.crm_session, {
    in: "cookie",
    name: "crm_session",
    type: "apiKey",
  });
});

test("locks the dynamic object and record API surface", async () => {
  const document = JSON.parse(
    await readFile(new URL("./openapi.json", import.meta.url), "utf8"),
  );
  const paths = [
    "/api/v1/workspaces/{tenantCode}/object-definitions",
    "/api/v1/workspaces/{tenantCode}/object-definitions/{objectId}/publications",
    "/api/v1/workspaces/{tenantCode}/objects",
    "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/schema",
    "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records",
    "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}",
    "/api/v1/workspaces/{tenantCode}/members/{memberId}/object-access",
    "/api/v1/workspaces/{tenantCode}/members/{memberId}/object-access/{objectId}",
  ];
  for (const path of paths) assert.ok(document.paths[path], path);

  assert.ok(document.components.schemas.ApiErrorResponseDto);
  assert.deepEqual(
    document.components.schemas.ApiErrorResponseDto.required.toSorted(),
    ["code", "fieldErrors", "message", "requestId", "status"],
  );
  assert.ok(document.components.schemas.PublishedObjectSchemaResponseDto);
  assert.deepEqual(
    document.paths[
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/schema"
    ].get.responses["200"].content["application/json"].schema,
    { $ref: "#/components/schemas/PublishedObjectSchemaResponseDto" },
  );
  assert.deepEqual(
    document.paths[
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records"
    ].get.responses["200"].content["application/json"].schema,
    { $ref: "#/components/schemas/RecordPageResponseDto" },
  );
});

test("declares every templated path parameter exactly once", async () => {
  const document = JSON.parse(
    await readFile(new URL("./openapi.json", import.meta.url), "utf8"),
  );
  const missing = [];
  const duplicated = [];
  const untyped = [];

  for (const [path, item] of Object.entries(document.paths)) {
    const templated = [...path.matchAll(/\{([^{}]+)\}/g)].map(
      (match) => match[1],
    );
    for (const [method, operation] of Object.entries(item)) {
      const declared = (operation.parameters ?? []).filter(
        (parameter) => parameter.in === "path",
      );
      for (const name of templated) {
        const matches = declared.filter((parameter) => parameter.name === name);
        if (matches.length === 0) {
          missing.push(`${method.toUpperCase()} ${path} ${name}`);
          continue;
        }
        if (matches.length > 1) {
          duplicated.push(`${method.toUpperCase()} ${path} ${name}`);
        }
        if (matches.some((parameter) => parameter.schema?.type !== "string")) {
          untyped.push(`${method.toUpperCase()} ${path} ${name}`);
        }
      }
    }
  }

  assert.deepEqual(missing, []);
  assert.deepEqual(duplicated, []);
  assert.deepEqual(untyped, []);
});
