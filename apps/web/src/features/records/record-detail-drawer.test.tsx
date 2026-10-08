import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { RecordDetailDrawer } from "./record-detail-drawer";

vi.mock("./record-workflow-panel", () => ({
  RecordWorkflowPanel: () => <section aria-label="工作流">执行工作流</section>,
}));
vi.mock("@/features/follow-ups/follow-up-panel", () => ({
  FollowUpPanel: () => <section aria-label="下一步跟进">安排下一步</section>,
}));
vi.mock("./record-activity-timeline", () => ({
  RecordActivityTimeline: () => (
    <section aria-label="活动历史">历史内容</section>
  ),
}));
vi.mock("./record-relations-panel", () => ({
  RecordRelationsPanel: () => <section>关联内容</section>,
}));
vi.mock("@/features/attachments/record-attachments-panel", () => ({
  RecordAttachmentsPanel: () => <section>附件内容</section>,
}));
const field = {
  required: false,
  defaultValue: null,
  validation: {},
  config: {},
  sortOrder: 1,
  isSystem: false,
  access: "READ_ONLY" as const,
  type: "TEXT" as const,
};
const schema: RuntimeObjectSchema = {
  publication: { number: 1, publishedAt: "2026-10-01" },
  object: {
    code: "customers",
    name: "客户",
    description: null,
    titleFieldKey: "name",
    icon: null,
    sortOrder: 1,
  },
  fields: [
    { ...field, id: "name", fieldKey: "name", label: "客户名称" },
    { ...field, id: "phase", fieldKey: "phase", label: "当前阶段" },
    { ...field, id: "notes", fieldKey: "notes", label: "详细说明" },
    {
      ...field,
      id: "secret",
      fieldKey: "secret",
      label: "隐藏字段",
      access: "HIDDEN",
    },
  ],
  defaultView: {
    code: "default",
    name: "默认",
    columnFieldKeys: ["phase", "secret"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: {
    canRead: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  },
  scopes: { read: "ALL", update: "ALL" },
};
const record: RecordSummary = {
  id: "r1",
  recordNo: "1",
  title: "客户甲",
  version: 7,
  ownerMemberId: "m1",
  values: {
    name: "客户甲",
    phase: "洽谈中",
    notes: "长业务说明",
    secret: "不可见",
  },
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};

describe("record detail reading hierarchy", () => {
  it("reports a committed deletion separately when its refresh callback rejects", async () => {
    const { recordApi } = await import("./record-api");
    const api = { ...recordApi, remove: vi.fn().mockResolvedValue(undefined) };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecordDetailDrawer
          tenantCode="northwind"
          schema={schema}
          record={record}
          canDelete
          api={api}
          onClose={vi.fn()}
          onChanged={async () => {
            throw new Error("refresh unavailable");
          }}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^删\s*除$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "删除记录" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "记录已删除，但刷新暂时失败。请返回列表重新载入，不要重复删除。",
    );
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /^删\s*除$/ })).toBeDisabled();
  });
  it("keeps a saved-record refresh warning visible after leaving edit mode", async () => {
    const { recordApi } = await import("./record-api");
    const api = {
      ...recordApi,
      update: vi.fn().mockResolvedValue({ ...record, version: 8 }),
    };
    const editableSchema = {
      ...schema,
      fields: schema.fields.map((entry) =>
        entry.fieldKey === "name"
          ? { ...entry, access: "EDIT" as const }
          : entry,
      ),
      actions: { ...schema.actions, canUpdate: true },
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecordDetailDrawer
          tenantCode="northwind"
          schema={editableSchema}
          record={record}
          initialEditing
          api={api}
          onClose={vi.fn()}
          onChanged={async () => {
            throw new Error("refresh unavailable");
          }}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "记录已保存，但刷新暂时失败。请重新载入查看最新记录，不要重复提交。",
    );
    expect(
      screen.queryByRole("button", { name: "保存修改" }),
    ).not.toBeInTheDocument();
  });
  it("does not close a new edit session when the previous refresh finishes", async () => {
    const { recordApi } = await import("./record-api");
    const api = {
      ...recordApi,
      update: vi.fn().mockResolvedValue({ ...record, version: 8 }),
    };
    const editableSchema = {
      ...schema,
      fields: schema.fields.map((entry) =>
        entry.fieldKey === "name"
          ? { ...entry, access: "EDIT" as const }
          : entry,
      ),
      actions: { ...schema.actions, canUpdate: true },
    };
    let rejectRefresh!: (error: Error) => void;
    const refresh = new Promise<void>((_, reject) => {
      rejectRefresh = reject;
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecordDetailDrawer
          tenantCode="northwind"
          schema={editableSchema}
          record={record}
          initialEditing
          api={api}
          onClose={vi.fn()}
          onChanged={async () => refresh}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "第一次保存" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "客户名称" })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^取\s*消$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^编\s*辑$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "新会话输入" },
    });

    await act(async () => {
      rejectRefresh(new Error("refresh unavailable"));
    });

    expect(screen.getByRole("button", { name: "保存修改" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue(
      "新会话输入",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "记录已保存，但刷新暂时失败",
    );
  });

  it("keeps the new edit input when an old HTTP save returns before a failed refresh", async () => {
    const { recordApi } = await import("./record-api");
    let resolveUpdate!: (saved: RecordSummary) => void;
    const api = {
      ...recordApi,
      update: vi.fn().mockReturnValue(
        new Promise<RecordSummary>((resolve) => {
          resolveUpdate = resolve;
        }),
      ),
    };
    const editableSchema = {
      ...schema,
      fields: schema.fields.map((entry) =>
        entry.fieldKey === "name"
          ? { ...entry, access: "EDIT" as const }
          : entry,
      ),
      actions: { ...schema.actions, canUpdate: true },
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecordDetailDrawer
          tenantCode="northwind"
          schema={editableSchema}
          record={record}
          initialEditing
          api={api}
          onClose={vi.fn()}
          onChanged={async () => {
            throw new Error("refresh unavailable");
          }}
        />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "旧保存输入" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /^取\s*消$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^编\s*辑$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "新会话输入" },
    });

    await act(async () => {
      resolveUpdate({ ...record, version: 8, title: "旧保存输入" });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "记录已保存，但刷新暂时失败",
    );
    expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue(
      "新会话输入",
    );
    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
  });

  it("keeps the new draft when an old HTTP save successfully updates the parent record", async () => {
    const { recordApi } = await import("./record-api");
    let resolveUpdate!: (saved: RecordSummary) => void;
    const api = {
      ...recordApi,
      update: vi.fn().mockReturnValue(
        new Promise<RecordSummary>((resolve) => {
          resolveUpdate = resolve;
        }),
      ),
    };
    const editableSchema = {
      ...schema,
      fields: schema.fields.map((entry) =>
        entry.fieldKey === "name"
          ? { ...entry, access: "EDIT" as const }
          : entry,
      ),
      actions: { ...schema.actions, canUpdate: true },
    };
    const client = new QueryClient();
    let currentRecord = record;
    const view = () => (
      <QueryClientProvider client={client}>
        <RecordDetailDrawer
          tenantCode="northwind"
          schema={editableSchema}
          record={currentRecord}
          initialEditing
          api={api}
          onClose={vi.fn()}
          onChanged={async (saved) => {
            currentRecord = saved!;
            rendered.rerender(view());
          }}
        />
      </QueryClientProvider>
    );
    const rendered = render(view());
    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "旧保存输入" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /^取\s*消$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^编\s*辑$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "新会话输入" },
    });
    await act(async () => {
      resolveUpdate({
        ...record,
        version: 8,
        title: "旧保存输入",
        values: { ...record.values, name: "旧保存输入" },
      });
    });
    expect(screen.getByText("旧保存输入")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue(
      "新会话输入",
    );
    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a new edit session open when a save cancelled mid-request resolves later", async () => {
    const { recordApi } = await import("./record-api");
    let resolveUpdate!: (saved: RecordSummary) => void;
    const api = {
      ...recordApi,
      update: vi.fn().mockReturnValue(
        new Promise<RecordSummary>((resolve) => {
          resolveUpdate = resolve;
        }),
      ),
    };
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const editableSchema = {
      ...schema,
      fields: schema.fields.map((entry) =>
        entry.fieldKey === "name"
          ? { ...entry, access: "EDIT" as const }
          : entry,
      ),
      actions: { ...schema.actions, canUpdate: true },
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecordDetailDrawer
          tenantCode="northwind"
          schema={editableSchema}
          record={record}
          initialEditing
          api={api}
          onClose={vi.fn()}
          onChanged={onChanged}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "第一次保存" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /^取\s*消$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^编\s*辑$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "第二次输入" },
    });

    await act(async () => {
      resolveUpdate({ ...record, version: 8 });
    });

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "保存修改" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue(
      "第二次输入",
    );
  });

  it("does not claim an assigned owner is unassigned when the roster is unavailable", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecordDetailDrawer
          tenantCode="northwind"
          schema={schema}
          record={record}
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("负责人：已指定")).toBeVisible();
  });

  it("tells a member without the roster that they own the record", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecordDetailDrawer
          tenantCode="northwind"
          schema={schema}
          record={record}
          currentMemberId="m1"
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("负责人：我")).toBeVisible();
  });
  it("prioritizes published summary and tasks while keeping full fields and secondary content discoverable", () => {
    const client = new QueryClient();
    client.setQueryData(
      ["relations", "northwind", "customers", "r1"],
      [{ id: "link1" }],
    );
    client.setQueryData(["attachments", "northwind", "customers", "r1"], []);
    render(
      <QueryClientProvider client={client}>
        <RecordDetailDrawer
          tenantCode="northwind"
          schema={schema}
          record={record}
          members={[{ id: "m1", displayName: "林晨" }]}
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const summary = screen.getByRole("region", { name: "记录摘要" });
    expect(within(summary).getByText("洽谈中")).toBeVisible();
    expect(within(summary).getByText(/负责人：林晨/)).toBeVisible();
    expect(screen.queryByText("不可见")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "工作流" })).toBeVisible();
    expect(screen.getByRole("region", { name: "下一步跟进" })).toBeVisible();
    expect(screen.getByRole("region", { name: "活动历史" })).toBeVisible();
    expect(screen.getByText("长业务说明")).not.toBeVisible();
    fireEvent.click(screen.getByText("完整业务字段"));
    expect(screen.getByText("长业务说明")).toBeVisible();
    expect(screen.getByText("关联业务记录（1）")).toBeVisible();
    expect(screen.getByText("附件（暂无附件）")).toBeVisible();
    expect(screen.getByText("关联内容")).not.toBeVisible();
    expect(screen.getByText("附件内容")).not.toBeVisible();
    expect(
      screen.queryByRole("button", { name: "编辑" }),
    ).not.toBeInTheDocument();
  });
});
