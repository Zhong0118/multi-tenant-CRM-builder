import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ObjectDraft,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import type { ObjectApi } from "@/features/objects/object-api";
import type { AutomationApi } from "./automation-api";
import type { AutomationRule } from "./automation-types";
import { AutomationDesigner } from "./automation-designer";

const draft = {
  object: {
    id: "source",
    code: "customers",
    name: "客户",
    version: 1,
    status: "ACTIVE",
    publicationNumber: null,
  },
  fields: [
    {
      id: "f1",
      fieldKey: "name",
      label: "客户名称",
      type: "TEXT",
      status: "ACTIVE",
      config: {},
      required: true,
      defaultValue: null,
    },
  ],
  activeRecordCount: 0,
} as unknown as ObjectDraft;
const rule: AutomationRule = {
  key: "confirm",
  label: "确认开单",
  enabled: true,
  allowedRoles: ["TENANT_ADMIN", "EMPLOYEE"],
  trigger: { type: "MANUAL" },
  targetObjectCode: "orders",
  owner: "ACTOR",
  mappings: { name: { source: "SOURCE_FIELD", fieldKey: "name" } },
};
function setup() {
  const api = {
    configuration: vi.fn().mockResolvedValue({
      objectId: "source",
      version: 1,
      rules: [rule],
      publishedRules: [],
    }),
    save: vi.fn().mockImplementation(async (_tenant, _id, _version, rules) => ({
      objectId: "source",
      version: 2,
      rules,
      publishedRules: [],
    })),
  } as unknown as AutomationApi;
  const objects = {
    listDrafts: vi.fn().mockResolvedValue([
      {
        object: {
          id: "target",
          code: "orders",
          name: "开单",
          status: "ACTIVE",
          publicationNumber: 1,
        },
      },
    ]),
    runtimeSchema: vi.fn().mockResolvedValue({
      object: { code: "orders", name: "开单" },
      fields: [
        {
          fieldKey: "name",
          label: "客户名称",
          type: "TEXT",
          config: {},
          required: true,
          defaultValue: null,
        },
      ],
    } as unknown as RuntimeObjectSchema),
  } as unknown as ObjectApi;
  const changed = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const renderDraft = (value: ObjectDraft) => (
    <QueryClientProvider client={client}>
      <AutomationDesigner
        tenantCode="demo"
        draft={value}
        api={api}
        objects={objects}
        onObjectVersion={changed}
      />
    </QueryClientProvider>
  );
  const rendered = render(renderDraft(draft));
  return {
    api,
    changed,
    rerender: (value: ObjectDraft) => rendered.rerender(renderDraft(value)),
  };
}
describe("AutomationDesigner", () => {
  it("shows draft versus published and explicitly tells admin to publish after saving", async () => {
    const { api, changed } = setup();
    await screen.findByText("有待发布的规则修改");
    fireEvent.click(screen.getByLabelText("查看规则 确认开单"));
    fireEvent.change(screen.getByLabelText("规则名称"), {
      target: { value: "确认签约" },
    });
    fireEvent.click(screen.getByText("保存规则草稿"));
    await screen.findByText("规则草稿已保存，发布业务表后生效");
    expect(api.save).toHaveBeenCalledWith("demo", "source", 1, [
      { ...rule, label: "确认签约" },
    ]);
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        object: expect.objectContaining({
          version: 2,
          hasUnpublishedChanges: true,
        }),
      }),
    );
  });
  it("does not show a draft rule as active", async () => {
    setup();
    await screen.findByText("有待发布的规则修改");
    fireEvent.click(screen.getByText("当前生效"));
    expect(
      screen.queryByLabelText("查看规则 确认开单"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("配置一条规则，查看业务表之间的联系"),
    ).toBeInTheDocument();
  });
});

it("refreshes live rules after publication without another draft edit", async () => {
  const { api, rerender } = setup();
  await screen.findByText("有待发布的规则修改");
  vi.mocked(api.configuration).mockResolvedValue({
    objectId: "source",
    version: 1,
    rules: [rule],
    publishedRules: [rule],
  });
  rerender({ ...draft, object: { ...draft.object, publicationNumber: 1 } });
  await screen.findByText("当前草稿与生效规则一致");
  fireEvent.click(screen.getByText("当前生效"));
  fireEvent.click(screen.getByLabelText("查看规则 确认开单"));
  expect(await screen.findByLabelText("规则名称")).toBeDisabled();
  expect(screen.queryByText("保存规则草稿")).not.toBeInTheDocument();
});
