import { afterEach, describe, expect, it, vi } from "vitest";

import { describeDevice, getDeviceIdentity } from "./form-support";

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

describe("describeDevice", () => {
  it("names the browser and system a person recognises", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        "MacIntel",
      ),
    ).toBe("Chrome · macOS");
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "iPhone",
      ),
    ).toBe("Safari · iPhone");
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0",
        "Win32",
      ),
    ).toBe("Edge · Windows");
    expect(describeDevice("", "")).toBe("浏览器 · 未知系统");
  });
});
