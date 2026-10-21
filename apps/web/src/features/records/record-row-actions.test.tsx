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
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
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
    fireEvent.click(await screen.findByRole("menuitem", { name: "释放到公共池" }));
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
    expect(screen.queryByRole("menuitem", { name: "释放到公共池" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("menuitem", { name: "分配负责人" })).not.toBeInTheDocument();
  });
});
