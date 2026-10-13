// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Stored = { id: string; messages: unknown[]; built: boolean };
const rows = new Map<string, Stored>();
let made = 0;
const POST = vi.fn(async (_path: string, { body }: { body: { messages: unknown[] } }) => {
  const row = { id: `c${++made}`, messages: body.messages, built: false };
  rows.set(row.id, row);
  return { data: row };
});
const PUT = vi.fn(async (_path: string, { params, body }: { params: { path: { id: string } }; body: { messages: unknown[] } }) => {
  const row = rows.get(params.path.id)!;
  if (row.built) throw Object.assign(new Error("built"), { code: "conversation/built" });
  row.messages = body.messages;
  return { data: row };
});
const GET = vi.fn(async (_path: string, { params }: { params: { path: { id: string } } }) => ({ data: rows.get(params.path.id)! }));
vi.mock("@/lib/api/client", () => ({ http: { GET, POST, PUT } }));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
vi.mock("@/lib/api/query-client", async () => ({ queryClient: client }));
const client = new QueryClient();
const { useAssistantConversation } = await import("./assistant-conversation");

const question = (id: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text: `Question ${id}` }] });
const sample = { id: "a", role: "assistant" as const, parts: [{ type: "data-sample" as const, data: { rows: [{ name: "Marie Curie" }] } }] };

function mount(id?: string) {
  const seen: ReturnType<typeof useAssistantConversation>[] = [];
  function Probe() {
    seen.push(useAssistantConversation(id));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  return { seen, last: () => seen.at(-1)!, render: () => root.render(h(QueryClientProvider, { client }, h(Probe))), root };
}

describe("the assistant's conversation, as the chat holds it", () => {
  it("is created by its first save, saved whole after, and stored stripped", async () => {
    const { last, render, root } = mount();
    await act(async () => render());
    expect(last()).toMatchObject({ id: null, messages: [], decisions: [] });

    let id!: string;
    await act(async () => void (id = await last().save([question("1"), sample])));
    expect(POST).toHaveBeenCalledTimes(1);
    expect(rows.get(id)!.messages).toEqual([question("1"), { id: "a", role: "assistant", parts: [] }]);
    expect(last().id).toBe(id);

    await act(async () => void (await last().save([question("1"), question("2")])));
    expect(PUT).toHaveBeenCalledTimes(1);
    expect(rows.get(id)!.messages).toEqual([question("1"), question("2")]);
    act(() => root.unmount());
  });

  it("resumes a conversation by id, and carries on in a new one once a graph was built from it", async () => {
    rows.set("built", { id: "built", messages: [question("1")], built: true });
    const { last, render, root } = mount("built");
    await act(async () => render());
    await vi.waitFor(() => expect(last().messages).toEqual([question("1")]));

    let id!: string;
    await act(async () => void (id = await last().save([question("1"), question("2")])));
    expect(id).not.toBe("built");
    expect(rows.get("built")!.messages).toEqual([question("1")]);
    expect(rows.get(id)!.messages).toEqual([question("1"), question("2")]);
    expect(last().id).toBe(id);
    act(() => root.unmount());
  });
});
