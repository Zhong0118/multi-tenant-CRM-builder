import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  avatarTone,
  MemberIdentity,
  memberInitial,
  memberSelectOptions,
} from "./member-identity";

describe("memberInitial", () => {
  it.each([
    ["孙悦", "孙"],
    ["欧阳 明", "欧"],
    ["alice wong", "A"],
    ["  ✨Zoe", "Z"],
    ["（临时）李雷", "临"],
    ["007", "0"],
    ["", "?"],
    [null, "?"],
    ["🙂🙂", "?"],
  ])("%s → %s", (name, initial) => {
    expect(memberInitial(name)).toBe(initial);
  });
});

describe("MemberIdentity", () => {
  it("shows the full name beside the avatar, never the avatar alone", () => {
    render(
      <MemberIdentity
        member={{ id: "m-1", displayName: "孙悦", status: "ACTIVE" }}
      />,
    );
    expect(screen.getByText("孙悦")).toBeVisible();
    expect(screen.getByText("孙")).toHaveAttribute("aria-hidden");
  });

  it("keeps a stable colour per member id, even for identical names", () => {
    expect(avatarTone("member-1")).toEqual(avatarTone("member-1"));
    const tones = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(
        (id) => avatarTone(`member-${id}`)[0],
      ),
    );
    expect(tones.size).toBeGreaterThan(1);
  });

  it("says 未指定 for no owner and invents no member", () => {
    render(<MemberIdentity memberId={null} />);
    expect(screen.getByText("未指定")).toBeVisible();
  });

  it("names a member outside the viewer's roster without exposing the id", () => {
    const { container } = render(<MemberIdentity memberId="0f3c2e9a-uuid" />);
    expect(screen.getByText("其他成员")).toBeVisible();
    expect(container.textContent).not.toContain("0f3c2e9a");
  });

  it("marks a disabled member in words, not only colour", () => {
    render(
      <MemberIdentity
        member={{ id: "m-2", displayName: "王强", status: "DISABLED" }}
      />,
    );
    expect(screen.getByText("王强")).toBeVisible();
    expect(screen.getByText("已停用")).toBeVisible();
  });

  it("falls back to 未设置姓名 for a member without a name", () => {
    render(<MemberIdentity member={{ id: "m-3", displayName: "  " }} />);
    expect(screen.getByText("未设置姓名")).toBeVisible();
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});

describe("memberSelectOptions", () => {
  const members = [
    { id: "a", displayName: "孙悦", status: "ACTIVE" as const },
    { id: "b", displayName: "王强", status: "DISABLED" as const },
  ];

  it("offers active members only, searchable by name", () => {
    expect(
      memberSelectOptions(members).map((option) => [
        option.value,
        option.searchText,
      ]),
    ).toEqual([["a", "孙悦"]]);
  });

  it("keeps a disabled current value visible but not choosable", () => {
    const options = memberSelectOptions(members, { selected: "b" });
    expect(options.find((option) => option.value === "b")).toMatchObject({
      disabled: true,
      searchText: "王强",
    });
  });

  it("lets filters include disabled members", () => {
    expect(
      memberSelectOptions(members, { includeDisabled: true }).map(
        (option) => option.disabled,
      ),
    ).toEqual([false, false]);
  });
});
