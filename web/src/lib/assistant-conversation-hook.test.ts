// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The conversations table, as `PUT /v1/conversations/{id}` keeps it: the client's id, upserted. */
type Stored = { id: string; messages: unknown[]; built: boolean };
const rows = new Map<string, Stored>();
type Init = { params: { path: { id: string } }; body?: { messages: unknown[] } };
const PUT = vi.fn(async (_path: string, { params, body }: Init) => {
  const row = rows.get(params.path.id);
  if (row?.built) throw Object.assign(new Error("built"), { code: "conversation/built" });
  const saved = { id: params.path.id, messages: body!.messages, built: false };
  rows.set(saved.id, saved);
  return { data: saved };
});
const GET = vi.fn(async (_path: string, { params }: Init) => {
  const row = rows.get(params.path.id);
  if (!row) throw Object.assign(new Error("No such conversation"), { code: "conversation/not-found" });
  return { data: row };
});
const $api = {
  queryOptions: (method: string, path: string, init: Init) => ({
    queryKey: [method, path, init],
    queryFn: async () => (await GET(path, init)).data,
  }),
};
vi.mock("@/lib/api/client", () => ({ http: { GET, PUT }, $api }));

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
  it("is a new id of the client's, started by its first save, saved whole after, and stored stripped", async () => {
    const { last, render, root } = mount();
    await act(async () => render());
    await vi.waitFor(() => expect(last()).toMatchObject({ messages: [], decisions: [] }));
    const { id } = last();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () => void expect(await last().save([question("1"), sample])).toBe(id));
    // The sample's row is the person's data: its part is not kept, and a message of none is not stored.
    expect(rows.get(id)!.messages).toEqual([question("1")]);

    await act(async () => void (await last().save([question("1"), question("2")])));
    expect(rows.get(id)!.messages).toEqual([question("1"), question("2")]);
    expect(last().id).toBe(id);
    act(() => root.unmount());
  });

  it("resumes a conversation by id, and carries on in a new one when a graph was built from it", async () => {
    rows.set("built", { id: "built", messages: [question("1")], built: true });
    const { last, render, root } = mount("built");
    await act(async () => render());
    await vi.waitFor(() => expect(last().messages).toEqual([question("1")]));
    expect(last().id).not.toBe("built");

    let id!: string;
    await act(async () => void (id = await last().save([question("1"), question("2")])));
    expect(id).toBe(last().id);
    expect(rows.get("built")!.messages).toEqual([question("1")]);
    expect(rows.get(id)!.messages).toEqual([question("1"), question("2")]);
    act(() => root.unmount());
  });

  it("carries on in a new one when a graph is built from it meanwhile", async () => {
    rows.set("mine", { id: "mine", messages: [question("1")], built: false });
    const { last, render, root } = mount("mine");
    await act(async () => render());
    await vi.waitFor(() => expect(last().messages).toEqual([question("1")]));
    expect(last().id).toBe("mine");

    rows.get("mine")!.built = true;
    let id!: string;
    await act(async () => void (id = await last().save([question("1"), question("2")])));
    expect(id).not.toBe("mine");
    expect(rows.get(id)!.messages).toEqual([question("1"), question("2")]);
    await vi.waitFor(() => expect(last().id).toBe(id));
    act(() => root.unmount());
  });
});
