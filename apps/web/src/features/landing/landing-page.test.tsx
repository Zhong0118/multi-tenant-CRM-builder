import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ICP_RECORD } from "./content";
import { ProductDemo } from "./demo/product-demo";
import { LandingPage } from "./landing-page";

afterEach(() => {
  vi.useRealTimers();
});

const panel = (id: string) => document.getElementById(`scenario-panel-${id}`)!;
const tab = (id: string) => document.getElementById(`scenario-tab-${id}`)!;

describe("LandingPage", () => {
  it("links only to its own sections, sign-in, registration and the ICP lookup", () => {
    const { container } = render(<LandingPage />);

    for (const link of container.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        expect(document.getElementById(href.slice(1)), href).not.toBeNull();
      } else if (href.startsWith("https://")) {
        expect(href).toBe(ICP_RECORD.lookup);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
      } else {
        expect(["/", "/login", "/register"]).toContain(href);
      }
    }
    for (const label of ["产品", "使用场景", "常见问题"]) {
      expect(
        within(screen.getByRole("navigation", { name: "页面导航" })).getByRole(
          "link",
          { name: label },
        ),
      ).toBeInTheDocument();
    }
  });

  it("exposes every customer stage without requiring scroll animation", () => {
    render(<LandingPage />);
    const flow = within(screen.getByRole("list", { name: "客户完整流转说明" }));
    expect(flow.getAllByRole("listitem")).toHaveLength(4);
    for (const stage of [
      "线索公海",
      "我的待联系",
      "我的跟进客户",
      "我的成交客户",
    ]) {
      expect(flow.getByText(stage, { exact: true })).toBeInTheDocument();
    }
    expect(flow.getByText(/明确需求后标记询单/)).toBeInTheDocument();
    expect(
      flow.getByText(/合同达到管理员配置的确认状态后/),
    ).toBeInTheDocument();
  });

  it("shows the filing number in the footer, linked to the official lookup", () => {
    render(<LandingPage />);
    const icp = screen.getByRole("link", { name: ICP_RECORD.number });
    expect(icp).toHaveAttribute("href", "https://beian.miit.gov.cn/");
    expect(icp.closest("footer")).not.toBeNull();
  });

  it("presents released work as available and carries no roadmap or build labels", () => {
    const { container } = render(<LandingPage />);
    const text = container.textContent ?? "";
    for (const stale of ["尚未上线", "正在路上", "V1", "测试版"]) {
      expect(text).not.toContain(stale);
    }
    expect(text).toContain("跨表关联与自动化");
    expect(text).toContain("团队进展");
    expect(text).toContain("任务与日报");
    // One sample-data note, not one per section.
    expect(text.match(/虚构/g)).toHaveLength(1);
  });

  it("closes the phone menu on Escape and returns focus to its button", () => {
    render(<LandingPage />);
    const toggle = screen.getByText("菜单").closest("button")!;

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("landing-menu")).toHaveAttribute(
      "data-open",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });
});

describe("ProductDemo", () => {
  it("switches scenarios with the arrow, Home and End keys inside one window", () => {
    render(<ProductDemo />);
    const tabs = screen.getAllByRole("tab");
    const visible = () =>
      screen
        .getAllByRole("tabpanel", { hidden: true })
        .filter((node) => !node.hidden)
        .map((node) => node.id);

    expect(tabs).toHaveLength(5);
    expect(visible()).toEqual(["scenario-panel-import"]);

    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowDown" });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(visible()).toEqual(["scenario-panel-pool"]);

    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(tabs[4]).toHaveFocus();
    fireEvent.keyDown(tabs[4], { key: "ArrowRight" });
    expect(tabs[0]).toHaveFocus();
    expect(tabs.map((node) => node.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it("imports a checked sheet into the lead pool the next scenario shows", () => {
    render(<ProductDemo />);
    const imports = within(panel("import"));

    fireEvent.click(imports.getByRole("button", { name: "检查数据" }));
    expect(imports.getByText(/客户名称为必填/)).toBeInTheDocument();
    expect(imports.getByRole("button", { name: "导入 3 条" })).toBeDisabled();

    fireEvent.click(imports.getByRole("button", { name: "补填" }));
    fireEvent.click(imports.getByRole("button", { name: "导入 3 条" }));
    expect(
      imports.getByText(/已新增 3 条客户，并放进了线索池/),
    ).toBeInTheDocument();

    fireEvent.click(imports.getByRole("button", { name: "去线索公海看看 →" }));
    expect(tab("pool")).toHaveAttribute("aria-selected", "true");
    const pool = within(panel("pool"));
    expect(
      pool.getByRole("button", { name: "领取 北岸物业服务中心" }),
    ).toBeInTheDocument();
    expect(pool.getAllByText("新导入")).toHaveLength(3);
  });

  it("only a contact that got through moves a claimed lead on", () => {
    vi.useFakeTimers();
    render(<ProductDemo />);
    fireEvent.click(tab("pool"));
    const pool = within(panel("pool"));

    fireEvent.click(pool.getByRole("button", { name: "领取 南湖实验学校" }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(pool.getByRole("button", { name: /待联系/ }));
    expect(pool.getByText(/剩 23:59:5\d/)).toBeInTheDocument();

    fireEvent.click(
      pool.getByRole("button", { name: "登记联系：南湖实验学校" }),
    );
    fireEvent.click(pool.getByRole("button", { name: "电话 · 未接通" }));
    expect(pool.getByText("未接通 1 次")).toBeInTheDocument();
    expect(pool.getByRole("status")).toHaveTextContent("不算联系成功");

    fireEvent.click(
      pool.getByRole("button", { name: "登记联系：南湖实验学校" }),
    );
    fireEvent.click(pool.getByRole("button", { name: "电话 · 已接通" }));
    fireEvent.click(pool.getByRole("button", { name: /跟进中/ }));
    expect(pool.getByText("南湖实验学校")).toBeInTheDocument();
    expect(pool.getByText("跟进期限 30 天")).toBeInTheDocument();
  });

  it("completes a follow-up, schedules the next one and reads messages", () => {
    render(<ProductDemo />);
    fireEvent.click(tab("follow-up"));
    const work = within(panel("follow-up"));

    fireEvent.click(
      work.getByRole("button", { name: "完成：南湖实验学校 确认报价单" }),
    );
    const tomorrow = work.getByRole("button", { name: "明天" });
    expect(tomorrow).toHaveFocus();
    fireEvent.click(tomorrow);
    expect(work.getByText("南湖实验学校 · 明天 10:00")).toBeInTheDocument();

    const bell = work.getByRole("button", { name: /消息/ });
    expect(bell).toHaveTextContent("4");
    fireEvent.click(bell);
    expect(bell).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(work.getByRole("button", { name: "全部已读" }));
    expect(bell).not.toHaveTextContent("4");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bell).toHaveAttribute("aria-expanded", "false");
    expect(bell).toHaveFocus();
  });

  it("switches the team period and assigns a task", () => {
    render(<ProductDemo />);
    fireEvent.click(tab("team"));
    const team = within(panel("team"));
    const zhouCalls = () =>
      within(
        team.getByRole("rowheader", { name: "周航" }).closest("tr")!,
      ).getAllByRole("cell")[0];

    expect(zhouCalls()).toHaveTextContent("4");
    fireEvent.click(team.getByRole("button", { name: "本周" }));
    expect(zhouCalls()).toHaveTextContent("18");

    fireEvent.click(team.getByRole("button", { name: "安排任务" }));
    fireEvent.click(team.getByRole("button", { name: "安排" }));
    expect(team.getByText("给城东社区医院发正式报价")).toBeInTheDocument();
    expect(team.getByText("团队任务")).toHaveTextContent("2");
  });

  it("keeps focus on the AI outcome after confirming", () => {
    render(<ProductDemo />);
    fireEvent.click(tab("ai"));
    const ai = within(panel("ai"));
    fireEvent.click(
      ai.getByRole("button", {
        name: "南湖实验学校报价确认后，帮我约下周一上门送样",
      }),
    );
    fireEvent.click(ai.getByRole("button", { name: "确认执行" }));
    expect(ai.getByRole("status")).toHaveFocus();
  });

  it("resets every scenario and is disabled until something changes", () => {
    render(<ProductDemo />);
    const reset = screen.getByRole("button", { name: "重置演示" });
    expect(reset).toBeDisabled();

    fireEvent.click(
      within(panel("import")).getByRole("button", { name: "检查数据" }),
    );
    fireEvent.click(tab("pool"));
    fireEvent.click(
      within(panel("pool")).getByRole("button", { name: "领取 南湖实验学校" }),
    );
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    expect(reset).toBeDisabled();
    expect(
      within(panel("import")).getByRole("button", {
        name: "检查数据",
        hidden: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(panel("pool")).getByRole("button", { name: "领取 南湖实验学校" }),
    ).toBeInTheDocument();
  });
});
