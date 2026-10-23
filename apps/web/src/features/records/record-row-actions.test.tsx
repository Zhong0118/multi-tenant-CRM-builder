import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

import { RecordRowActions } from "./record-row-actions";
import type { RecordPoolApi } from "./record-pool-api";

const config = { enabled: true, ownershipTtlHours: 24, version: 2 };
const record: RecordSummary = {
  recordNo: "1",
  values: {},
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
  id: "r1",
  title: "客户甲",
  version: 7,
  ownerMemberId: "me",
  inPublicPool: false,
  ownershipExpiresAt: null,
};
const schema = {
  actions: { canRead: true, canUpdate: true, canDelete: true },
  scopes: { read: "OWN", update: "OWN" },
} as RuntimeObjectSchema;

function backend(): RecordPoolApi {
  return {
    getConfig: vi.fn().mockResolvedValue(config),
    saveConfig: vi.fn(),
    changeOwnership: vi.fn().mockResolvedValue({ recordId: "r1", version: 8 }),
  };
}

function renderMenu(
  overrides: Partial<React.ComponentProps<typeof RecordRowActions>> = {},
) {
  const pool = backend();
  const handlers = {
    onView: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onChanged: vi.fn(),
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <RecordRowActions
        tenantCode="northwind"
        objectCode="customers"
        schema={schema}
        record={record}
        config={config}
        currentMemberId="me"
        isAdmin={false}
        api={pool}
        editable
        editBlockedReason="无编辑权限"
        canDelete
        deleting={false}
        {...handlers}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "更多操作 客户甲" }));
  return { pool, ...handlers };
}

describe("record row actions menu", () => {
  it("opens the record from the menu", async () => {
    const { onView } = renderMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "查看" }));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it("releases to the public pool only after confirmation, with the displayed version", async () => {
    const { pool, onChanged } = renderMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "释放到公共池" }),
    );
    expect(pool.changeOwnership).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "确认释放" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("RELEASE"));
    expect(pool.changeOwnership).toHaveBeenCalledWith(
      "northwind",
      "customers",
      "r1",
      { action: "RELEASE", version: 7 },
    );
  });

  it("offers claiming a public-pool record and not releasing it", async () => {
    const { pool, onChanged } = renderMenu({
      record: { ...record, inPublicPool: true, ownerMemberId: null },
    });
    expect(await screen.findByRole("menuitem", { name: "领取" })).toBeEnabled();
    expect(
      screen.queryByRole("menuitem", { name: "释放到公共池" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "领取" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("CLAIM"));
    expect(pool.changeOwnership).toHaveBeenCalledWith(
      "northwind",
      "customers",
      "r1",
      { action: "CLAIM", version: 7 },
    );
  });

  it("shows why a disabled action is unavailable instead of hiding it", async () => {
    renderMenu({
      editable: false,
      editBlockedReason: "领取后可编辑",
      canDelete: false,
    });
    expect(
      await screen.findByRole("menuitem", { name: "编辑（领取后可编辑）" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitem", { name: "删除（无删除权限）" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("only admins can assign an owner", async () => {
    renderMenu({ isAdmin: false });
    await screen.findByRole("menuitem", { name: "查看" });
    expect(
      screen.queryByRole("menuitem", { name: "分配负责人" }),
    ).not.toBeInTheDocument();
  });
});

describe("lifecycle actions in the row menu", () => {
  const lifecycleConfig = { ...config, lifecycleEnabled: true };

  it("confirms contact with the displayed version", async () => {
    const { pool, onChanged } = renderMenu({
      config: lifecycleConfig,
      record: { ...record, poolStage: "PENDING_CONTACT" },
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "确认已联系" }),
    );
    expect(pool.changeOwnership).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "确认建立联系" }),
    );
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith("CONFIRM_CONTACT"),
    );
    expect(pool.changeOwnership).toHaveBeenCalledWith(
      "northwind",
      "customers",
      "r1",
      {
        action: "CONFIRM_CONTACT",
        version: 7,
      },
    );
  });

  it("requires a reason and submits the chosen quality when releasing", async () => {
    const { pool, onChanged } = renderMenu({
      config: lifecycleConfig,
      record: { ...record, poolStage: "FOLLOWING" },
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "释放到公共池" }),
    );
    const release = await screen.findByRole("button", { name: "确认释放" });
    expect(release).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "释放原因" }), {
      target: { value: "  号码无效  " },
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "资源质量" }));
    fireEvent.click(await screen.findByText("空号 / 无效"));
    fireEvent.click(release);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("RELEASE"));
    expect(pool.changeOwnership).toHaveBeenCalledWith(
      "northwind",
      "customers",
      "r1",
      {
        action: "RELEASE",
        version: 7,
        reason: "号码无效",
        quality: "INVALID",
      },
    );
  });

  it("uses UNPROTECT_RELEASE when an administrator releases a protected record", async () => {
    const { pool, onChanged } = renderMenu({
      config: lifecycleConfig,
      isAdmin: true,
      record: { ...record, poolStage: "PROTECTED" },
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "解除保护并释放" }),
    );
    fireEvent.change(await screen.findByRole("textbox", { name: "释放原因" }), {
      target: { value: "已复核保护依据" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认释放" }));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith("UNPROTECT_RELEASE"),
    );
    expect(pool.changeOwnership).toHaveBeenCalledWith(
      "northwind",
      "customers",
      "r1",
      {
        action: "UNPROTECT_RELEASE",
        version: 7,
        reason: "已复核保护依据",
      },
    );
  });

  it("does not offer protected release to an employee", async () => {
    renderMenu({
      config: lifecycleConfig,
      record: { ...record, poolStage: "PROTECTED" },
    });
    await screen.findByRole("menuitem", { name: "查看" });
    expect(
      screen.queryByRole("menuitem", { name: /释放/ }),
    ).not.toBeInTheDocument();
  });

  it("requires administrators to classify legacy pool records explicitly", async () => {
    const { pool } = renderMenu({
      config: lifecycleConfig,
      isAdmin: true,
      record: { ...record, inPublicPool: true, ownerMemberId: null },
    });
    expect(
      screen.queryByRole("menuitem", { name: "领取" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "归类到公共池" }),
    );
    fireEvent.change(await screen.findByRole("textbox", { name: "释放原因" }), {
      target: { value: "历史资源归类" },
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "目标公共池" }));
    fireEvent.click(await screen.findByText("已联系公共池"));
    fireEvent.click(screen.getByRole("button", { name: "确认释放" }));
    await waitFor(() =>
      expect(pool.changeOwnership).toHaveBeenCalledWith(
        "northwind",
        "customers",
        "r1",
        {
          action: "RELEASE",
          version: 7,
          reason: "历史资源归类",
          poolStage: "CUSTOMER_POOL",
        },
      ),
    );
  });

  it("explains why employees cannot claim unclassified legacy pool records", async () => {
    renderMenu({
      config: lifecycleConfig,
      record: { ...record, inPublicPool: true, ownerMemberId: null },
    });
    expect(
      await screen.findByRole("menuitem", { name: "等待管理员归类后领取" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByRole("menuitem", { name: "领取" }),
    ).not.toBeInTheDocument();
  });
});
