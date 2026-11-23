import type { TableBlueprint, TablePlan } from "@crm/contracts";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TableBuilder } from "./table-builder";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function plan(id: string, name: string): TablePlan {
  return {
    id,
    code: id,
    name,
    reason: "业务需要",
    titleFieldId: id + "_name",
    fields: [
      {
        id: id + "_name",
        label: name + "名称",
        type: "TEXT",
        fieldKey: "name",
        required: true,
        reason: "识别记录",
      },
    ],
    view: { columnIds: [id + "_name"], reason: "常用信息" },
    employeeIntent: [],
  };
}
const blueprint: TableBlueprint = {
  version: 1,
  tables: [plan("clients", "客户"), plan("contracts", "合同")],
  assumptions: [],
  omitted: [{ request: "附件字段", reason: "使用记录附件区" }],
};
function preview(value = blueprint) {
  return { kind: "blueprint" as const, blueprint: value, issues: [] };
}
function setup() {
  const api = {
    preview: vi.fn().mockResolvedValue(preview()),
    validate: vi
      .fn()
      .mockImplementation(async (_t, { blueprint: value }) => preview(value)),
    refine: vi.fn(),
    confirm: vi.fn(),
    analyze: vi.fn(),
    publish: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TableBuilder tenantCode="north" api={api} />
    </QueryClientProvider>,
  );
  return api;
}
const describeBusiness = () =>
  fireEvent.change(screen.getByLabelText("业务描述"), {
    target: { value: "设备租赁" },
  });
const generate = () => fireEvent.click(screen.getByText("生成预览"));
beforeEach(() => vi.clearAllMocks());

it("keeps the administrator's input on failure and submits only the edited, validated tables", async () => {
  const api = setup();
  api.preview.mockRejectedValueOnce(new Error("暂时无法生成"));
  describeBusiness();
  generate();
  expect(await screen.findByText(/暂时无法生成/)).toBeVisible();
  expect(screen.getByLabelText("业务描述")).toHaveValue("设备租赁");
  generate();
  fireEvent.click(await screen.findByLabelText("移除表 客户"));
  await waitFor(() =>
    expect(
      screen.getByText("确认创建 1 张草稿").closest("button"),
    ).toBeEnabled(),
  );
  let finish!: (result: ReturnType<typeof preview>) => void;
  api.validate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.change(screen.getByLabelText("表名称"), {
    target: { value: "设备合同" },
  });
  expect(
    screen.getByText("确认创建 1 张草稿").closest("button"),
  ).toBeDisabled();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.change(screen.getByLabelText("表名称"), {
    target: { value: "租赁合同" },
  });
  await waitFor(() =>
    expect(
      screen.getByText("确认创建 1 张草稿").closest("button"),
    ).toBeEnabled(),
  );
  await act(async () => finish(preview()));
  expect(screen.getByLabelText("表名称")).toHaveValue("租赁合同");
  api.confirm.mockResolvedValue({
    objects: [{ id: "object-1", code: "contracts", version: 3 }],
  });
  fireEvent.click(screen.getByText("确认创建 1 张草稿"));
  await screen.findByText("检查整组发布");
  expect(
    api.confirm.mock.calls[0][1].blueprint.tables.map((t: TablePlan) => t.name),
  ).toEqual(["租赁合同"]);
  expect(api.publish).not.toHaveBeenCalled();
});

it("previews an intent recommendation without granting it, shows the effective grant, and sends the reviewed choices only on confirm", async () => {
  const api = setup();
  const sample = structuredClone(blueprint);
  sample.tables[0].employeeIntent = [
    {
      request: "销售只能看自己负责的客户",
      reason: "销售权限",
      recommendation: "CREATE_OWN",
    },
  ];
  api.preview.mockResolvedValue(preview(sample));
  api.confirm.mockResolvedValue({ objects: [] });
  describeBusiness();
  generate();
  expect(await screen.findByLabelText("客户的员工权限")).toHaveValue("CLOSED");
  fireEvent.click(screen.getByRole("button", { name: /采用推荐/ }));
  expect(screen.getByLabelText("客户的员工权限")).toHaveValue("CREATE_OWN");
  expect(screen.getByLabelText("合同的员工权限")).toHaveValue("CLOSED");
  expect(screen.getByText(/应用后 · 可新建 · 查看范围 本人负责/)).toBeVisible();
  expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("客户的员工权限"), {
    target: { value: "CLOSED" },
  });
  fireEvent.change(screen.getByLabelText("合同的员工权限"), {
    target: { value: "READ_ALL_UPDATE_OWN" },
  });
  expect(screen.getByText(/应用后 · 不可新建 · 查看范围 全部/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "确认员工权限并创建 2 张草稿" }),
  );
  await waitFor(() =>
    expect(api.confirm).toHaveBeenCalledWith("north", {
      blueprint: sample,
      target: undefined,
      employeePresets: { clients: "CLOSED", contracts: "READ_ALL_UPDATE_OWN" },
    }),
  );
});

it("allows only the selected table's reviewed refinement into the current blueprint", async () => {
  const api = setup();
  describeBusiness();
  generate();
  fireEvent.change(await screen.findByLabelText("调整说明"), {
    target: { value: "改名并添加说明" },
  });
  const next = structuredClone(blueprint);
  next.tables[0].name = "租赁客户";
  next.tables[1].name = "意外修改";
  api.refine.mockResolvedValue(preview(next));
  fireEvent.click(screen.getByText("按说明调整"));
  await screen.findByText("采用调整");
  expect(screen.getByLabelText("表名称")).toHaveValue("客户");
  expect(screen.getByText("租赁客户")).toBeVisible();
  fireEvent.click(screen.getByText("采用调整"));
  await waitFor(() =>
    expect(screen.getByLabelText("表名称")).toHaveValue("租赁客户"),
  );
  expect(screen.queryByText("意外修改")).toBeNull();
  expect(api.confirm).not.toHaveBeenCalled();
});

it("collects a fixed other answer and retains it on retry", async () => {
  const api = setup();
  api.preview.mockResolvedValueOnce({
    kind: "question",
    key: "industry",
    prompt: "所属行业",
    options: [{ id: "other", label: "其他" }],
  });
  describeBusiness();
  generate();
  fireEvent.click(await screen.findByText("其他"));
  fireEvent.change(screen.getByLabelText("其他回答"), {
    target: { value: "设备租赁" },
  });
  fireEvent.click(screen.getByText("继续生成"));
  await screen.findByLabelText("表名称");
  expect(api.preview.mock.calls[1][1].answers).toEqual([
    { key: "industry", choiceId: "other", otherText: "设备租赁" },
  ]);
});

it("reads group analysis before publication and reloads every version after a blocking permission issue", async () => {
  const api = setup();
  describeBusiness();
  generate();
  api.confirm.mockResolvedValue({
    objects: [
      { id: "ob1", code: "clients", version: 5 },
      { id: "ob2", code: "contracts", version: 3 },
    ],
  });
  const objects = ["ob1", "ob2"].map((id, i) => ({
    id,
    name: i ? "合同" : "客户",
    code: i ? "contracts" : "clients",
    version: 7 + i,
    poolConfigVersion: 0,
    analysis: { blocking: [], warnings: [], changes: [] },
  }));
  api.analyze
    .mockResolvedValueOnce({
      objects,
      blocking: [{ objectId: "ob1", message: "请配置标题字段权限" }],
    })
    .mockResolvedValue({ objects, blocking: [] });
  api.publish.mockResolvedValue({ published: objects });
  fireEvent.click(await screen.findByText("确认创建 2 张草稿"));
  fireEvent.click(await screen.findByText("检查整组发布"));
  expect(await screen.findByText("请配置标题字段权限")).toBeVisible();
  expect(screen.getByText("确认发布 2 张表").closest("button")).toBeDisabled();
  fireEvent.click(screen.getByText("重新分析"));
  await waitFor(() =>
    expect(screen.getByText("确认发布 2 张表").closest("button")).toBeEnabled(),
  );
  fireEvent.click(screen.getByText("确认发布 2 张表"));
  await screen.findByText("已发布 2 张业务表");
  expect(api.publish.mock.calls[0][1].objects).toEqual([
    { id: "ob1", expectedVersion: 7, expectedPoolConfigVersion: 0 },
    { id: "ob2", expectedVersion: 8, expectedPoolConfigVersion: 0 },
  ]);
});

it("lets an administrator resolve incompatible select options after changing a field type", async () => {
  const api = setup();
  const sample = structuredClone(blueprint);
  sample.tables[0].fields[0].type = "SINGLE_SELECT";
  sample.tables[0].fields[0].options = [
    { id: "old-option", key: "standard", label: "标准", reason: "常用" },
  ];
  api.preview.mockResolvedValue(preview(sample));
  describeBusiness();
  generate();
  fireEvent.change(await screen.findByLabelText("字段类型 1"), {
    target: { value: "TEXT" },
  });
  fireEvent.click(screen.getByLabelText("移除选项 标准"));
  await waitFor(() => expect(api.validate).toHaveBeenCalled());
  expect(
    api.validate.mock.lastCall?.[1].blueprint.tables[0].fields[0].options,
  ).toBeUndefined();
});

it("cancels generation, retains the request and discards a late response", async () => {
  const api = setup();
  let finish!: (result: ReturnType<typeof preview>) => void;
  api.preview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  describeBusiness();
  generate();
  expect(screen.getByText(/正在生成方案/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
  expect(api.preview.mock.calls[0][2].aborted).toBe(true);
  expect(screen.getByLabelText("业务描述")).toHaveValue("设备租赁");
  generate();
  await screen.findByDisplayValue("客户");
  const stale = structuredClone(blueprint);
  stale.tables[0].name = "已取消";
  await act(async () => finish(preview(stale)));
  expect(screen.queryByDisplayValue("已取消")).toBeNull();
});

it("revalidates a table code and a field key before submitting the edited identifiers", async () => {
  const api = setup();
  api.confirm.mockResolvedValue({ objects: [] });
  describeBusiness();
  generate();
  fireEvent.change(await screen.findByLabelText("表编码"), {
    target: { value: "rental-customers" },
  });
  fireEvent.change(screen.getByLabelText("字段键 1"), {
    target: { value: "customer_name" },
  });
  const confirm = screen.getByRole("button", { name: /确认.*创建 2 张草稿/ });
  expect(confirm).toBeDisabled();
  await waitFor(() => expect(confirm).toBeEnabled());
  const table = api.validate.mock.lastCall?.[1].blueprint.tables[0];
  expect(table.code).toBe("rental-customers");
  expect(table.fields[0].fieldKey).toBe("customer_name");
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(api.confirm.mock.calls[0][1].blueprint.tables[0]).toEqual(table),
  );
});

it("restores a manual substitute to its owning table only after explicit selection", async () => {
  const api = setup();
  const value = structuredClone(blueprint);
  const owner = value.tables[1];
  const manual = {
    id: "net",
    fieldKey: "net_total",
    label: "含税费用",
    type: "MONEY" as const,
    required: false,
    reason: "由管理员选择后手动录入。",
  };
  value.omitted.push({
    request: "含税费用",
    reason: "当前不支持自动计算",
    tableId: owner.id,
    manualField: manual,
  });
  api.preview.mockResolvedValue(preview(value));
  describeBusiness();
  generate();
  fireEvent.click(await screen.findByText(/已内置／未采纳/));
  expect(api.validate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "作为手填字段添加" }));
  expect(screen.getByRole("button", { name: "已添加手填字段" })).toBeDisabled();
  await waitFor(() => expect(api.validate).toHaveBeenCalled());
  const submitted = api.validate.mock.lastCall?.[1].blueprint;
  expect(submitted.tables[0]).toEqual(value.tables[0]);
  expect(submitted.tables[1].fields).toEqual([...owner.fields, manual]);
  expect(screen.getByLabelText("表名称")).toHaveValue(owner.name);
});

it("keeps all over-limit candidates available while validating only the checked tables", async () => {
  const api = setup();
  const value = structuredClone(blueprint);
  value.tables = Array.from({ length: 7 }, (_, i) =>
    plan(String(i), "实体" + i),
  );
  api.preview.mockResolvedValue({
    ...preview(value),
    issues: [
      {
        code: "TABLE_COUNT",
        path: "tables",
        blocking: true,
        message: "一次最多创建 6 张，请移除 1 张",
      },
    ],
  });
  describeBusiness();
  generate();
  const first = await screen.findByRole("checkbox", { name: "本次创建 实体0" });
  expect(
    screen.getByText("确认创建 7 张草稿").closest("button"),
  ).toBeDisabled();
  fireEvent.click(first);
  await waitFor(() =>
    expect(
      screen.getByText("确认创建 6 张草稿").closest("button"),
    ).toBeEnabled(),
  );
  expect(first).not.toBeChecked();
  expect(
    api.validate.mock.lastCall?.[1].blueprint.tables.map(
      (t: TablePlan) => t.name,
    ),
  ).toEqual(value.tables.slice(1).map((t) => t.name));
  fireEvent.click(first);
  fireEvent.click(screen.getByRole("checkbox", { name: "本次创建 实体5" }));
  await waitFor(() =>
    expect(
      api.validate.mock.lastCall?.[1].blueprint.tables.map(
        (t: TablePlan) => t.id,
      ),
    ).toEqual(["0", "1", "2", "3", "4", "6"]),
  );
});
