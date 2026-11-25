import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileAvatar } from "./profile-avatar";

describe("account and roster avatar", () => {
  it("falls back to the initial on a failed download and retries a new version", () => {
    const { container, rerender } = render(
      <ProfileAvatar name="赵晨" avatarUrl="/api/v1/users/1/avatar/a" />,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toContain("/api/v1/users/1/avatar/a");
    fireEvent.error(img);
    expect(container).toHaveTextContent("赵");
    rerender(
      <ProfileAvatar name="赵晨" avatarUrl="/api/v1/users/1/avatar/b" />,
    );
    expect(container.querySelector("img")!.getAttribute("src")).toContain(
      "/avatar/b",
    );
    rerender(<ProfileAvatar />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
