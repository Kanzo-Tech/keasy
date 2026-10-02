import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availabilityOf, CHECK_MS, debouncer } from "./use-folder-availability";

describe("debouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("settles on the last value once typing pauses", () => {
    const settle = vi.fn();
    const d = debouncer(CHECK_MS, settle);
    d.push("p");
    vi.advanceTimersByTime(CHECK_MS - 1);
    d.push("pe");
    vi.advanceTimersByTime(CHECK_MS - 1);
    expect(settle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settle).toHaveBeenCalledExactlyOnceWith("pe");
  });

  it("settles on nothing once cancelled", () => {
    const settle = vi.fn();
    const d = debouncer(CHECK_MS, settle);
    d.push("people");
    d.cancel();
    vi.advanceTimersByTime(CHECK_MS * 2);
    expect(settle).not.toHaveBeenCalled();
  });
});

describe("availabilityOf", () => {
  it("says nothing when there is nothing to ask", () => {
    expect(availabilityOf(null, "sink/people", { available: true }, false)).toBeNull();
  });

  it("is checking until the folder as typed has settled and been answered", () => {
    expect(availabilityOf("sink/people", "sink/peo", { available: true }, false)).toBe("checking");
    expect(availabilityOf("sink/people", "sink/people", undefined, false)).toBe("checking");
  });

  it("is the server's answer for the settled folder", () => {
    expect(availabilityOf("sink/people", "sink/people", { available: true }, false)).toBe("available");
    expect(availabilityOf("sink/people", "sink/people", { available: false }, false)).toBe("taken");
  });

  it("leaves a failed question to Create's own answer", () => {
    expect(availabilityOf("sink/people", "sink/people", undefined, true)).toBeNull();
  });
});
