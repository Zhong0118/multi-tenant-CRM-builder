import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ReportDraft } from "./report-draft";
const base = { plans: "", completed: "旧内容", problems: "", nextSteps: "" };
it("previews the latest local values, adopts chosen fields only, and leaves save to the editor", async () => {
  const apply = vi.fn();
  const load = vi.fn().mockResolvedValue({
    empty: false,
    sections: { ...base, completed: "已回访", nextSteps: "明日联系" },
    generatedAt: "2026-11-24T08:00:00Z",
  });
  const props = {
    tenantCode: "demo",
    workDate: "2026-11-24",
    current: base,
    onApply: apply,
    load,
  };
  const view = render(<ReportDraft {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "AI 起草" }));
  expect(await screen.findByText("已回访")).toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
  view.rerender(
    <ReportDraft {...props} current={{ ...base, completed: "刚编辑" }} />,
  );
  expect(screen.getByText("刚编辑")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "采用明日安排" }));
  fireEvent.click(screen.getByRole("button", { name: "采用所选内容" }));
  expect(apply).toHaveBeenCalledWith({ ...base, completed: "刚编辑\n已回访" });
});
