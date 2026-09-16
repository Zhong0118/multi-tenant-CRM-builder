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

test("types every object configuration response the designer consumes", async () => {
  const document = JSON.parse(
    await readFile(new URL("./openapi.json", import.meta.url), "utf8"),
  );
  const schemas = document.components.schemas;

  assert.deepEqual(schemas.ObjectDraftResponseDto.required.toSorted(), [
    "activeRecordCount",
    "defaultView",
    "employeeAccess",
    "fields",
    "object",
  ]);

  // The designer reads derived facts, never the raw published snapshot, so the
  // browser cannot end up re-interpreting the published configuration.
  const draftObject = schemas.ObjectDraftObjectResponseDto.properties;
  assert.equal(draftObject.hasUnpublishedChanges.type, "boolean");
  assert.equal(draftObject.publicationNumber.type, "number");
  assert.deepEqual(draftObject.status.enum, ["DRAFT", "ACTIVE", "ARCHIVED"]);
  assert.equal(
    schemas.ObjectDraftResponseDto.properties.activeSchema,
    undefined,
  );

  // A published field type is locked, so the designer must be told which type
  // is already live rather than inferring it.
  const draftField = schemas.ObjectDraftFieldResponseDto.properties;
  assert.ok(Array.isArray(draftField.publishedType.enum));
  assert.deepEqual(draftField.status.enum, ["ACTIVE", "INACTIVE"]);
  assert.deepEqual(draftField.employeeAccess.enum, [
    "EDIT",
    "READ_ONLY",
    "HIDDEN",
  ]);

  assert.deepEqual(schemas.PublicationAnalysisResponseDto.required.toSorted(), [
    "blocking",
    "changes",
    "warnings",
  ]);
  assert.deepEqual(schemas.PublicationChangeResponseDto.properties.kind.enum, [
    "ADDED",
    "UPDATED",
    "INACTIVATED",
  ]);

  const base = "/api/v1/workspaces/{tenantCode}/object-definitions";
  const draftRef = { $ref: "#/components/schemas/ObjectDraftResponseDto" };
  const responseSchema = (path, method, status) =>
    document.paths[path][method].responses[status].content["application/json"]
      .schema;

  assert.deepEqual(responseSchema(base, "get", "200"), {
    items: draftRef,
    type: "array",
  });
  assert.deepEqual(responseSchema(base, "post", "201"), draftRef);
  assert.deepEqual(
    responseSchema(`${base}/{objectId}`, "get", "200"),
    draftRef,
  );
  assert.deepEqual(
    responseSchema(`${base}/{objectId}`, "patch", "200"),
    draftRef,
  );
  assert.deepEqual(
    responseSchema(`${base}/{objectId}/publication-analysis`, "post", "200"),
    { $ref: "#/components/schemas/PublicationAnalysisResponseDto" },
  );
  assert.deepEqual(
    responseSchema(`${base}/{objectId}/publications`, "post", "201"),
    { $ref: "#/components/schemas/ObjectPublicationResponseDto" },
  );
  assert.deepEqual(
    responseSchema(`${base}/{objectId}/publications`, "get", "200"),
    {
      items: { $ref: "#/components/schemas/ObjectPublicationResponseDto" },
      type: "array",
    },
  );
});

test("gives every parameter and property a usable JSON type", async () => {
  const document = JSON.parse(
    await readFile(new URL("./openapi.json", import.meta.url), "utf8"),
  );

  // `{ "type": "object" }` with no properties and no additionalProperties
  // generates as `Record<string, never>`, which cannot hold the uuid, icon or
  // default value it is meant to describe. The shared `Object` component is
  // the same defect surfaced as a $ref.
  const isOpaque = (schema) => {
    if (!schema) return false;
    if (schema.$ref === "#/components/schemas/Object") return true;
    if (Array.isArray(schema.allOf)) return schema.allOf.some(isOpaque);
    return (
      schema.type === "object" &&
      schema.properties === undefined &&
      schema.additionalProperties === undefined
    );
  };

  const opaque = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      for (const parameter of operation.parameters ?? []) {
        if (isOpaque(parameter.schema)) {
          opaque.push(
            `${method.toUpperCase()} ${path} ${parameter.in}:${parameter.name}`,
          );
        }
      }
    }
  }
  for (const [name, schema] of Object.entries(document.components.schemas)) {
    for (const [property, value] of Object.entries(schema.properties ?? {})) {
      if (isOpaque(value)) opaque.push(`${name}.${property}`);
    }
  }

  assert.deepEqual(opaque, []);
});

/**
 * §31 — the runtime response exposes a STATIC effect summary (what a transition
 * will do) and a lightweight execution summary (what it did), and both are
 * NAMED component schemas so the generated client gets a usable type.
 *
 * The static summary is a safety boundary: the schema itself must have nowhere
 * to put a field key, a mapping source or a permission. Asserting the property
 * list here pins that at the contract level, not only in the API tests.
 */
test("names the runtime effect summary schema and keeps it static", async () => {
  const document = JSON.parse(
    await readFile(new URL("./openapi.json", import.meta.url), "utf8"),
  );
  const schemas = document.components.schemas;

  const effect = schemas.RuntimeTransitionEffectDto;
  assert.ok(effect, "RuntimeTransitionEffectDto must be a named schema");
  assert.deepEqual(Object.keys(effect.properties).toSorted(), [
    "label",
    "type",
  ]);
  assert.deepEqual(effect.required.toSorted(), ["label", "type"]);
  assert.equal(effect.properties.label.type, "string");
  assert.deepEqual(effect.properties.type.enum.toSorted(), [
    "ASSIGN_OWNER",
    "CREATE_FOLLOW_UP",
    "CREATE_RECORD",
    "CREATE_RELATION",
    "UPDATE_RECORD",
  ]);
  assert.equal(effect.properties.type.type, "string");

  const effectRef = { $ref: "#/components/schemas/RuntimeTransitionEffectDto" };
  const effects = schemas.RuntimeAvailableTransitionDto.properties.effects;
  assert.equal(effects.type, "array");
  assert.deepEqual(effects.items, effectRef);
  assert.ok(schemas.RuntimeAvailableTransitionDto.required.includes("effects"));

  const summary = schemas.RuntimeExecutionSummaryDto;
  assert.ok(summary, "RuntimeExecutionSummaryDto must be a named schema");
  assert.deepEqual(Object.keys(summary.properties).toSorted(), [
    "actions",
    "transitionKey",
    "workflowExecutionId",
  ]);
  assert.deepEqual(summary.required.toSorted(), [
    "actions",
    "transitionKey",
    "workflowExecutionId",
  ]);
  assert.deepEqual(summary.properties.actions, {
    items: effectRef,
    type: "array",
  });
  assert.deepEqual(
    // A documented `$ref` is emitted as a single-entry `allOf`; either way the
    // property resolves to the NAMED schema, not to an inline object.
    schemas.RuntimeWorkflowResponseDto.properties.executionSummary.allOf,
    [{ $ref: "#/components/schemas/RuntimeExecutionSummaryDto" }],
  );
  // §35: additive only — a client written before Task 11 still type-checks
  // against the same response body.
  assert.equal(
    schemas.RuntimeWorkflowResponseDto.required.includes("executionSummary"),
    false,
  );
});
