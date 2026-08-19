import { describe, expect, it } from "vitest";

import { loadWorkerConfig } from "./worker.config.js";

describe("loadWorkerConfig", () => {
  it("rejects a missing Redis URL", () => {
    expect(() => loadWorkerConfig({})).toThrow(/REDIS_URL/);
  });

  it("returns a validated Redis URL", () => {
    expect(loadWorkerConfig({ REDIS_URL: "redis://localhost:6379" })).toEqual({
      redisUrl: "redis://localhost:6379",
    });
  });
});
