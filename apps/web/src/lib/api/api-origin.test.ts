import { describe, expect, it } from "vitest";

import { resolveBrowserApiOrigin } from "./api-origin";

describe("resolveBrowserApiOrigin", () => {
  it("keeps localhost for a localhost page", () => {
    expect(resolveBrowserApiOrigin("http://localhost:3001", "localhost")).toBe(
      "http://localhost:3001",
    );
  });

  it("uses the page loopback hostname for API calls and session cookies", () => {
    expect(resolveBrowserApiOrigin("http://localhost:3001", "127.0.0.1")).toBe(
      "http://127.0.0.1:3001",
    );
  });

  it("does not rewrite a non-local API hostname", () => {
    expect(
      resolveBrowserApiOrigin("https://api.example.com", "127.0.0.1"),
    ).toBe("https://api.example.com");
  });
});
