import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components build; the module under test is plain env reading.
vi.mock("server-only", () => ({}));

const { modelWindows } = await import("./model-windows");

describe("modelWindows", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads each alias's declared window, in tokens", () => {
    vi.stubEnv("KEASY_AI_CHAT_CONTEXT", "16384");
    vi.stubEnv("KEASY_AI_COMPLETE_CONTEXT", " 8192 ");
    expect(modelWindows()).toEqual({ chat: 16384, complete: 8192 });
  });

  it("passes no budget for an alias the platform declares none for, or one that is not a whole count", () => {
    vi.stubEnv("KEASY_AI_CHAT_CONTEXT", "");
    vi.stubEnv("KEASY_AI_COMPLETE_CONTEXT", "8k");
    expect(modelWindows()).toEqual({ chat: undefined, complete: undefined });
    vi.stubEnv("KEASY_AI_CHAT_CONTEXT", "-1");
    vi.stubEnv("KEASY_AI_COMPLETE_CONTEXT", "8192.5");
    expect(modelWindows()).toEqual({ chat: undefined, complete: undefined });
  });
});
