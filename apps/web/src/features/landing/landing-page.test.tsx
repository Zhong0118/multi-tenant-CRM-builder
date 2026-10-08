import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LandingPage } from "./landing-page";
import { AiStep, FollowUpStep } from "./demo-steps";
import { ProductDemo } from "./product-demo";

describe("LandingPage", () => {
  it("links only to its own sections and to sign-in or invited registration", () => {
    const { container } = render(<LandingPage />);

    for (const link of container.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        expect(document.getElementById(href.slice(1)), href).not.toBeNull();
      } else {
        expect(["/", "/login", "/register"]).toContain(href);
      }
      // Public sign-up is closed, so every way into registration has to say
      // it is for people who already have an invitation.
      if (href === "/register") {
        expect(link.textContent).toMatch(/邀请|受邀/);
      }
    }
  });

  it("moves through the demo steps with the arrow, Home and End keys", () => {
    const { container } = render(<LandingPage />);
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    const visiblePanels = () =>
      [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
        .filter((panel) => !panel.hidden)
        .map((panel) => panel.id);

    expect(visiblePanels()).toEqual(["demo-panel-import"]);

    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();
    expect(visiblePanels()).toEqual(["demo-panel-assign"]);

    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(tabs.at(-1)).toHaveFocus();
    fireEvent.keyDown(tabs.at(-1)!, { key: "ArrowRight" });
    expect(tabs[0]).toHaveFocus();
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1]);
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

  it("keeps the demo's announced orientation in sync with its responsive layout", () => {
    let onChange = () => {};
    const media = {
      matches: false,
      addEventListener: vi.fn((_event, listener) => {
        onChange = listener;
      }),
      removeEventListener: vi.fn(),
    };
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockReturnValue(media as unknown as MediaQueryList);
    try {
      const { unmount } = render(<ProductDemo />);
      expect(screen.getByRole("tablist")).toHaveAttribute(
        "aria-orientation",
        "horizontal",
      );
      act(() => {
        media.matches = true;
        onChange();
      });
      expect(screen.getByRole("tablist")).toHaveAttribute(
        "aria-orientation",
        "vertical",
      );
      unmount();
      expect(media.removeEventListener).toHaveBeenCalled();
    } finally {
      matchMedia.mockRestore();
    }
  });

  it.each(["确认执行", "拒绝"])(
    "keeps keyboard focus on the AI outcome after %s",
    (action) => {
      render(<AiStep />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "报价确认后，帮我约下周一上门送样",
        }),
      );
      const button = screen.getByRole("button", { name: action });
      button.focus();
      fireEvent.click(button);
      expect(screen.getByRole("status")).toHaveFocus();
    },
  );

  it("moves focus through completing and scheduling a follow-up", () => {
    render(<FollowUpStep />);
    const complete = screen.getByRole("button", {
      name: "标记完成，安排下一步",
    });
    complete.focus();
    fireEvent.click(complete);
    expect(screen.getByLabelText("事项")).toHaveFocus();
    const due = screen.getByLabelText("时间");
    due.focus();
    fireEvent.change(due, { target: { value: "下周一 09:30" } });
    expect(due).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "安排跟进" }));
    expect(screen.getByText("寄送正式报价单").parentElement).toHaveFocus();
  });
});
