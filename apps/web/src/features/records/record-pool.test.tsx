import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecordOwnershipActions, RecordPoolSettings } from "./record-pool";
import type { RecordPoolApi } from "./record-pool-api";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

const config = { enabled: true, ownershipTtlHours: 24, version: 2 };
const record: RecordSummary = {
  recordNo: "1",
  values: {},
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
  id: "r1",
  title: "客户甲",
  version: 7,
  ownerMemberId: null,
  inPublicPool: true,
  ownershipExpiresAt: null,
};
const schema = {
  actions: { canRead: true, canUpdate: true },
  scopes: { read: "OWN", update: "OWN" },
} as RuntimeObjectSchema;
function api(overrides: Partial<RecordPoolApi> = {}): RecordPoolApi {
  return {
    getConfig: vi.fn().mockResolvedValue(config),
    saveConfig: vi.fn().mockResolvedValue({ ...config, version: 3 }),
    changeOwnership: vi.fn().mockResolvedValue({ recordId: "r1", version: 8 }),
    ...overrides,
  };
}
function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
describe("pool ownership", () => {
  it("claims with the displayed version and refreshes committed state", async () => {
    const backend = api();
    const changed = vi.fn();
    wrap(
      <RecordOwnershipActions
        tenantCode="northwind"
        objectCode="customers"
        schema={schema}
        record={record}
        config={config}
        isAdmin={false}
        api={backend}
        onChanged={changed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "领取 客户甲" }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith("CLAIM"));
    expect(backend.changeOwnership).toHaveBeenCalledWith(
      "northwind",
      "customers",
      "r1",
      { action: "CLAIM", version: 7 },
    );
  });
  it("does not offer claim to a read-only employee or release of another owner's record", () => {
    const { rerender } = wrap(
      <RecordOwnershipActions
        tenantCode="northwind"
        objectCode="customers"
        schema={{ ...schema, actions: { ...schema.actions, canUpdate: false } }}
        record={record}
        config={config}
        isAdmin={false}
        api={api()}
        onChanged={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "领取 客户甲" }),
    ).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <RecordOwnershipActions
          tenantCode="northwind"
          objectCode="customers"
          schema={schema}
          record={{ ...record, ownerMemberId: "other", inPublicPool: false }}
          currentMemberId="me"
          config={config}
          isAdmin={false}
          api={api()}
          onChanged={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByRole("button", { name: "释放 客户甲" }),
    ).not.toBeInTheDocument();
  });
  it("shows concurrent claim conflicts without reporting success", async () => {
    const changed = vi.fn();
    wrap(
      <RecordOwnershipActions
        tenantCode="northwind"
        objectCode="customers"
        schema={schema}
        record={record}
        config={config}
        isAdmin={false}
        api={api({
          changeOwnership: vi
            .fn()
            .mockRejectedValue({
              status: 409,
              code: "RECORD_VERSION_CONFLICT",
              message: "记录已变化",
              requestId: "req-1",
            }),
        })}
        onChanged={changed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "领取 客户甲" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("刷新");
    expect(changed).not.toHaveBeenCalled();
  });
  it("keeps administrator assignment available while pool is disabled", () => {
    wrap(
      <RecordOwnershipActions
        tenantCode="northwind"
        objectCode="customers"
        schema={schema}
        record={{ ...record, inPublicPool: false }}
        config={{ ...config, enabled: false }}
        isAdmin
        api={api()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "分配 客户甲" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "领取 客户甲" }),
    ).not.toBeInTheDocument();
  });
});
describe("pool settings", () => {
  it("saves versioned configuration immediately with pause and existing deadline explanations", async () => {
    const backend = api();
    const saved = vi.fn();
    wrap(
      <RecordPoolSettings
        tenantCode="northwind"
        objectCode="customers"
        config={config}
        api={backend}
        onSaved={saved}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/无需发布/)).toBeInTheDocument();
    expect(screen.getByText(/暂停.*回收/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "启用公共池" }));
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(backend.saveConfig).toHaveBeenCalledWith("northwind", "customers", {
      ...config,
      enabled: false,
    });
  });
});

it("releases only after confirmation with the displayed version", async () => {
  const backend = api();
  const changed = vi.fn();
  wrap(
    <RecordOwnershipActions
      tenantCode="northwind"
      objectCode="customers"
      schema={schema}
      record={{ ...record, inPublicPool: false, ownerMemberId: "me" }}
      currentMemberId="me"
      config={config}
      isAdmin={false}
      api={backend}
      onChanged={changed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "释放 客户甲" }));
  expect(backend.changeOwnership).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "确认释放" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith("RELEASE"));
  expect(backend.changeOwnership).toHaveBeenCalledWith(
    "northwind",
    "customers",
    "r1",
    { action: "RELEASE", version: 7 },
  );
});
it("requires an active member selection before assignment", async () => {
  const backend = api();
  const changed = vi.fn();
  wrap(
    <RecordOwnershipActions
      tenantCode="northwind"
      objectCode="customers"
      schema={schema}
      record={{ ...record, inPublicPool: false }}
      config={{ ...config, enabled: false }}
      isAdmin
      members={[{ id: "member-2", displayName: "林晨" }]}
      api={backend}
      onChanged={changed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "分配 客户甲" }));
  expect(
    await screen.findByRole("button", { name: "确认分配" }),
  ).toBeDisabled();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "分配负责人" }));
  fireEvent.click(await screen.findByText("林晨"));
  fireEvent.click(screen.getByRole("button", { name: "确认分配" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith("ASSIGN"));
  expect(backend.changeOwnership).toHaveBeenCalledWith(
    "northwind",
    "customers",
    "r1",
    { action: "ASSIGN", version: 7, ownerMemberId: "member-2" },
  );
});
it("blocks an empty automatic expiry and reports configuration conflicts", async () => {
  const backend = api({
    saveConfig: vi
      .fn()
      .mockRejectedValue({
        status: 409,
        code: "VERSION_CONFLICT",
        message: "设置已变化",
        requestId: "req-2",
      }),
  });
  const saved = vi.fn();
  wrap(
    <RecordPoolSettings
      tenantCode="northwind"
      objectCode="customers"
      config={config}
      api={backend}
      onSaved={saved}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "保留小时数" }), {
    target: { value: "" },
  });
  expect(screen.getByRole("button", { name: "保存设置" })).toBeDisabled();
  fireEvent.change(screen.getByRole("spinbutton", { name: "保留小时数" }), {
    target: { value: "48" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) => alert.textContent?.includes("刷新")),
    ).toBe(true),
  );
  expect(saved).not.toHaveBeenCalled();
});
it("does not invite duplicate ownership submissions when refresh fails", async () => {
  const backend = api();
  wrap(
    <RecordOwnershipActions
      tenantCode="northwind"
      objectCode="customers"
      schema={schema}
      record={record}
      config={config}
      isAdmin={false}
      api={backend}
      onChanged={async () => {
        throw new Error("offline");
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "领取 客户甲" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("操作已完成");
  expect(screen.getByRole("button", { name: "领取 客户甲" })).toBeDisabled();
});

it("keeps the version of the opened settings when a background refresh arrives", async () => {
  const backend = api();
  const props = { tenantCode: "northwind", objectCode: "customers", api: backend, onSaved: vi.fn(), onClose: vi.fn() };
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><RecordPoolSettings {...props} config={config} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("switch", { name: "启用公共池" }));
  view.rerender(<QueryClientProvider client={client}><RecordPoolSettings {...props} config={{ ...config, version: 3, ownershipTtlHours: 48 }} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() => expect(backend.saveConfig).toHaveBeenCalledWith("northwind", "customers", { ...config, enabled: false }));
});
