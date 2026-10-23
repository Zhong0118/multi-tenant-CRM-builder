import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiDemo } from "./ai-demo";
import { ICP_RECORD, ROADMAP } from "./content";
import { HeroWorkspace } from "./hero-workspace";
import { LandingPage } from "./landing-page";
import { TableDesigner } from "./table-designer";

afterEach(() => {
  vi.useRealTimers();
});

describe("LandingPage", () => {
  it("links to its own sections, sign-in, registration and the ICP lookup only", () => {
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
      if (href === "/register") {
        expect(link.textContent).toContain("创建账号");
      }
    }
  });

  it("shows the filing number in the footer, linked to the official lookup", () => {
    render(<LandingPage />);
    const icp = screen.getByRole("link", { name: ICP_RECORD.number });
    expect(icp).toHaveAttribute("href", "https://beian.miit.gov.cn/");
    expect(icp.closest("footer")).not.toBeNull();
  });

  it("labels every unreleased feature as not yet available", () => {
    render(<LandingPage />);
    const roadmap = document.getElementById("roadmap")!;
    expect(within(roadmap).getAllByText("尚未上线")).toHaveLength(
      ROADMAP.length,
    );
  });

  it("closes the phone menu on Escape and returns focus to its button", () => {
    render(<LandingPage />);
    const toggle = screen.getByText("菜单").closest("button")!;

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("landing-menu")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });
});

describe("HeroWorkspace", () => {
  it("moves a claimed lead to 待联系 and starts its 24-hour deadline", () => {
    vi.useFakeTimers();
    render(<HeroWorkspace />);

    expect(screen.getByText("领取后开始 24 小时联系期限")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "领取 城东社区医院" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(
      screen.queryByRole("button", { name: "领取 城东社区医院" }),
    ).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "已领取城东社区医院，进入待联系，联系期限 24 小时。",
    );
    expect(screen.getByText("剩 24:00:00")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("剩 23:59:58")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新演示" }));
    expect(
      screen.getByRole("button", { name: "领取 城东社区医院" }),
    ).toBeInTheDocument();
  });
});

describe("TableDesigner", () => {
  it("shows the new column to staff only after publishing", () => {
    render(<TableDesigner />);
    expect(screen.getByText("草稿 · 2 处待发布")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "预计签约" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByText("已发布")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "预计签约" }),
    ).toBeInTheDocument();
  });
});

describe("AiDemo", () => {
  it.each([
    ["确认执行", "跟进已写入"],
    ["拒绝", "没有写入任何数据"],
  ])("moves focus to the outcome after %s", (action, outcome) => {
    render(<AiDemo />);
    fireEvent.click(
      screen.getByRole("button", { name: "报价确认后，帮我约下周一上门送样" }),
    );
    const button = screen.getByRole("button", { name: action });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(outcome);
  });
});
