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
