// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { askHref, takeQuestion, useHandedQuestion } from "./ask-handoff";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the question handed to Ask", () => {
  it("is read off the URL, which keeps everything else", () => {
    expect(takeQuestion("https://k.test/graphs/g1/discover?panel=ask&q=Who%20won%20in%201903%3F#top")).toEqual({
      question: "Who won in 1903?",
      rest: "/graphs/g1/discover?panel=ask#top",
    });
    expect(takeQuestion("https://k.test/graphs/g1/discover?panel=ask&q=%20%20").question).toBeNull();
    expect(takeQuestion("https://k.test/graphs/g1/discover").question).toBeNull();
  });

  it("is read as the assistant wrote it", () => {
    expect(takeQuestion(`https://k.test${askHref("g1", "Who won in 1903?")}`)).toEqual({
      question: "Who won in 1903?",
      rest: "/graphs/g1/discover?panel=ask",
    });
    expect(askHref("g1")).toBe("/graphs/g1/discover?panel=ask");
  });

  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
  });

  function Asker({ send, ready }: { send: (q: string) => void; ready: boolean }) {
    useHandedQuestion(send, ready);
    return null;
  }

  const render = (send: (q: string) => void, ready: boolean) =>
    act(() => {
      root ??= createRoot(document.createElement("div"));
      root.render(h(Asker, { send, ready }));
    });

  it("waits for the model, is sent once, and leaves the URL", () => {
    window.history.replaceState(null, "", "/graphs/g1/discover?panel=ask&q=How%20many%20prizes%3F");
    const send = vi.fn();
    render(send, false);
    expect(send).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("How many prizes?");

    render(send, true);
    expect(send).toHaveBeenCalledExactlyOnceWith("How many prizes?");
    expect(window.location.pathname + window.location.search).toBe("/graphs/g1/discover?panel=ask");

    // Drawn again, and drawn anew as a refresh would: the question is not asked again.
    render(send, true);
    act(() => root?.unmount());
    root = undefined;
    render(send, true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("asks nothing when the URL hands no question", () => {
    window.history.replaceState(null, "", "/graphs/g1/discover?panel=ask");
    const send = vi.fn();
    render(send, true);
    expect(send).not.toHaveBeenCalled();
  });
});
