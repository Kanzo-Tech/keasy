// @vitest-environment happy-dom
import { act, createElement as h, StrictMode, useCallback, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChat } from "@ai-sdk/react";

import { askHref, hasAsked, takeQuestion, useHandedQuestion } from "./ask-handoff";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the offers Ask proposes", () => {
  it("are for an empty conversation: a question handed over, sent, or on its way is the person's", () => {
    const idle = { handed: false, messages: 0, status: "ready" };
    expect(hasAsked(idle)).toBe(false);
    expect(hasAsked({ ...idle, handed: true })).toBe(true);
    expect(hasAsked({ ...idle, messages: 1 })).toBe(true);
    expect(hasAsked({ ...idle, status: "submitted" })).toBe(true);
    expect(hasAsked({ ...idle, status: "streaming" })).toBe(true);
    // A failed answer is still the conversation's: the offers do not come back over it.
    expect(hasAsked({ ...idle, messages: 1, status: "error" })).toBe(true);
  });
});

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

  it("lands in a chat that is sent into as it mounts, under StrictMode, and is asked once", async () => {
    window.history.replaceState(null, "", "/graphs/g1/discover?panel=ask&q=How%20many%20prizes%3F");
    let asked = 0;
    const drawn = { messages: 0 };
    const transport = {
      sendMessages: async () => {
        asked++;
        return new ReadableStream({ start: (c) => c.close() });
      },
      reconnectToStream: async () => null,
    };
    function Chat() {
      const chat = useChat({ transport: transport as never });
      const { sendMessage } = chat;
      useHandedQuestion(
        useCallback((text: string) => void sendMessage({ text }), [sendMessage]),
        true,
      );
      const count = chat.messages.length;
      useEffect(() => {
        drawn.messages = count;
      });
      return null;
    }
    const strict = createRoot(document.createElement("div"));
    await act(async () => strict.render(h(StrictMode, null, h(Chat))));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect({ messages: drawn.messages, asked }).toEqual({ messages: 1, asked: 1 });
    expect(new URLSearchParams(window.location.search).get("q")).toBeNull();
    act(() => strict.unmount());
  });

  it("asks nothing when the URL hands no question", () => {
    window.history.replaceState(null, "", "/graphs/g1/discover?panel=ask");
    const send = vi.fn();
    render(send, true);
    expect(send).not.toHaveBeenCalled();
  });
});
