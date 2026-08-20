import { afterEach, describe, expect, it, vi } from "vitest";

import { getDeviceIdentity } from "./form-support";

afterEach(() => vi.unstubAllGlobals());

describe("getDeviceIdentity", () => {
  it("returns a deterministic fallback when browser globals are unavailable", () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("localStorage", undefined);

    expect(getDeviceIdentity()).toEqual({
      key: "crm-browser-device",
      summary: "浏览器 · 未知系统",
    });
  });
});
