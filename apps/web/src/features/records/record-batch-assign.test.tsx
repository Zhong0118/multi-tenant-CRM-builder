import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecordBatchAssignDrawer } from "./record-batch-assign";
import type { RecordSummary } from "@/features/objects/object-types";
import type { RecordPoolApi } from "./record-pool-api";

const record: RecordSummary = {
  id: "r1",
  recordNo: "1",
  title: "客户甲",
  values: {},
  version: 3,
  ownerMemberId: null,
  inPublicPool: true,
  ownershipExpiresAt: null,
  createdAt: "2026-10-15",
  updatedAt: "2026-10-15",
};

describe("batch ownership assignment", () => {
  it("assigns with versions, retains partial success and retries only failed rows", async () => {
    const changeOwnership = vi
      .fn<RecordPoolApi["changeOwnership"]>()
      .mockResolvedValueOnce({ recordId: "r1", version: 4 })
      .mockRejectedValueOnce({
        status: 503,
        message: "暂时无法分配",
        code: "SERVICE_UNAVAILABLE",
        requestId: "req-test",
        fieldErrors: {},
      })
      .mockResolvedValueOnce({ recordId: "r2", version: 5 });
    const onChanged = vi
      .fn()
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValue(undefined);
    render(
      <RecordBatchAssignDrawer
        tenantCode="northwind"
        objectCode="customers"
        records={[record, { ...record, id: "r2", title: "客户乙", version: 4 }]}
        members={[{ id: "m1", displayName: "员工甲" }]}
        api={{ changeOwnership, getConfig: vi.fn(), saveConfig: vi.fn() }}
        onChanged={onChanged}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "确认分配" })).toBeDisabled();
    fireEvent.mouseDown(screen.getByLabelText("批量分配负责人"));
    fireEvent.click(await screen.findByText("员工甲"));
    fireEvent.click(screen.getByRole("button", { name: "确认分配" }));
    await screen.findByText("成功 1 条，失败 1 条，未处理 0 条");
    await screen.findByText(/列表刷新失败/);
    expect(screen.getByText("客户乙：暂时无法分配")).toBeInTheDocument();
    expect(screen.getByLabelText("批量分配负责人")).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试失败项" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "重试失败项" }));
    await screen.findByText("成功 2 条，失败 0 条，未处理 0 条");
    expect(
      changeOwnership.mock.calls.map((call) => [call[2], call[3]]),
    ).toEqual([
      ["r1", { action: "ASSIGN", version: 3, ownerMemberId: "m1" }],
      ["r2", { action: "ASSIGN", version: 4, ownerMemberId: "m1" }],
      ["r2", { action: "ASSIGN", version: 4, ownerMemberId: "m1" }],
    ]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试失败项" })).toBeDisabled(),
    );
  });

  it("processes 1000 selected records and never restarts successful assignments", async () => {
    const changeOwnership = vi
      .fn<RecordPoolApi["changeOwnership"]>()
      .mockImplementation(async (_tenant, _object, id, input) => ({
        recordId: id,
        version: input.version + 1,
      }));
    render(
      <RecordBatchAssignDrawer
        tenantCode="northwind"
        objectCode="customers"
        records={Array.from({ length: 1000 }, (_, i) => ({
          ...record,
          id: `r${i}`,
        }))}
        members={[{ id: "m1", displayName: "员工甲" }]}
        api={{ changeOwnership, getConfig: vi.fn(), saveConfig: vi.fn() }}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText("批量分配负责人"));
    fireEvent.click(await screen.findByText("员工甲"));
    fireEvent.click(screen.getByRole("button", { name: "确认分配" }));
    await screen.findByText("成功 1000 条，失败 0 条，未处理 0 条");
    expect(
      new Set(changeOwnership.mock.calls.map((call) => call[2])).size,
    ).toBe(1000);
    expect(changeOwnership).toHaveBeenCalledTimes(1000);
  });

  it("refuses more than 1000 selected records before any ownership request", async () => {
    const changeOwnership = vi.fn<RecordPoolApi["changeOwnership"]>();
    const onChanged = vi.fn();
    render(
      <RecordBatchAssignDrawer
        tenantCode="northwind"
        objectCode="customers"
        records={Array.from({ length: 1001 }, (_, i) => ({
          ...record,
          id: `r${i}`,
        }))}
        members={[{ id: "m1", displayName: "员工甲" }]}
        api={{ changeOwnership, getConfig: vi.fn(), saveConfig: vi.fn() }}
        onChanged={onChanged}
        onClose={vi.fn()}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText("批量分配负责人"));
    fireEvent.click(await screen.findByText("员工甲"));
    expect(
      screen.getByText("批量分配负责人每次最多 1000 条，请减少勾选"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认分配" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "确认分配" }));
    expect(changeOwnership).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
