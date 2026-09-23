"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Coordinator } from "@uwdata/mosaic-core";
import {
  Button,
  Clipboard,
  ClipboardTrigger,
  Show,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  useDataTable,
} from "@kanzo-tech/ui/table";
import {
  Conversation,
  ConversationContent,
  ConversationEmpty,
  ConversationScrollButton,
  Message,
  MessageContent,
  MessageList,
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  type RunState,
  SuggestList,
  SuggestMark,
  SuggestRoot,
  Task,
  TaskList,
  TaskStatus,
  TaskTitle,
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  useAiStream,
} from "@kanzo-tech/ai";
import { MessageMarkdown } from "@kanzo-tech/ai/markdown";
import { useCoordinator } from "./use-discovery-store";
import { PanelHeader } from "@/components/layout/workspace-layout";
import { ApiError, api } from "@/lib/api";
import { sseFailure } from "@/lib/api/sse";
import { queryKeys } from "@/lib/query-keys";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { generateSuggestions } from "@/lib/schema-suggestions";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";
import { isError } from "@/lib/error-codes";
import type { GraphSchema } from "@/lib/graph-schema";
import { describeDataSpace } from "@/lib/data-space";

// ── The turn ─────────────────────────────────────────────────────────────

type Phase = "generating" | "executing" | "explaining" | "done";

const ORDER: Phase[] = ["generating", "executing", "explaining", "done"];

const STEPS = [
  { phase: "generating", title: "Write a query" },
  { phase: "executing", title: "Run it over the graph" },
  { phase: "explaining", title: "Read the rows back" },
] as const satisfies readonly { phase: Phase; title: string }[];

type AskEvent =
  | { kind: "conversation"; id: string }
  | { kind: "phase"; phase: Phase }
  | { kind: "plan"; sql: string | null; answer: string; reasoning: string }
  | { kind: "explain"; text: string }
  | { kind: "explained"; text: string }
  | { kind: "failed"; code: string; message: string };

type TurnEvent = Exclude<AskEvent, { kind: "conversation" }>;

interface Turn {
  id: number;
  question: string;
  phase: Phase;
  reasoning: string;
  sql: string | null;
  answer: string;
  explanation: string;
  failure: { code: string; message: string } | null;
  /** The phase the run stopped in, which is the step that wears the failure. */
  failedAt: Phase | null;
}

function apply(turn: Turn, event: TurnEvent): Turn {
  switch (event.kind) {
    case "phase":
      return { ...turn, phase: event.phase };
    case "plan":
      return { ...turn, sql: event.sql, answer: event.answer, reasoning: event.reasoning };
    case "explain":
      return { ...turn, explanation: turn.explanation + event.text };
    case "explained":
      return { ...turn, explanation: event.text };
    case "failed":
      return {
        ...turn,
        failure: { code: event.code, message: event.message },
        failedAt: turn.phase,
      };
  }
}

function stepState(step: Phase, turn: Turn): RunState {
  const mine = ORDER.indexOf(step);
  if (turn.failedAt) {
    const broke = ORDER.indexOf(turn.failedAt);
    if (mine < broke) return "done";
    return mine === broke ? "failed" : "pending";
  }
  const at = ORDER.indexOf(turn.phase);
  if (mine < at) return "done";
  return mine === at ? "running" : "pending";
}

function toolState(turn: Turn): RunState {
  if (turn.failure) return "failed";
  return turn.phase === "done" ? "done" : "running";
}

// ── The source ───────────────────────────────────────────────────────────

/** How much of the result set the model is shown before it reads the rows back. */
const SAMPLE_ROWS = 30;
const SAMPLE_CHARS = 4000;

type ResultRow = Record<string, unknown>;

interface Plan {
  sql?: string;
  answer: string;
  reasoning?: string;
  code: string;
}

interface AskOptions {
  jobId: string;
  question: string;
  conversationId: string | null;
  provider?: string;
  schema?: string;
  coordinator: Coordinator | null;
  signal: AbortSignal;
}

async function sample(coordinator: Coordinator | null, sql: string): Promise<string> {
  if (!coordinator) return "";
  const rows = ((await coordinator.query(sql, { type: "json" })) ?? []) as ResultRow[];
  const json = JSON.stringify(rows.slice(0, SAMPLE_ROWS));
  return json.length > SAMPLE_CHARS ? `${json.slice(0, SAMPLE_CHARS)}...` : json;
}

/**
 * One whole turn as one stream: the model writes a query, DuckDB runs it here,
 * and the rows go back for a reading. A failure is a value rather than a throw,
 * because a turn that broke still belongs in the transcript.
 */
async function* askTurn(options: AskOptions): AsyncIterable<AskEvent> {
  const { jobId, question, provider, schema, coordinator, signal } = options;
  try {
    let conversationId = options.conversationId;
    let plan: Plan | null = null;

    for await (const frame of api.discovery.askStream(jobId, question, {
      conversationId: conversationId ?? undefined,
      provider,
      schema,
      signal,
    })) {
      const failure = sseFailure(frame);
      if (failure) {
        yield { kind: "failed", ...failure };
        return;
      }
      if (frame.event === "conversation") {
        const { conversation_id } = JSON.parse(frame.data) as { conversation_id: string };
        if (conversation_id) {
          conversationId = conversation_id;
          yield { kind: "conversation", id: conversation_id };
        }
      } else if (frame.event === "complete") {
        plan = JSON.parse(frame.data) as Plan;
      }
    }

    if (!plan) {
      yield { kind: "phase", phase: "done" };
      return;
    }
    if (isError(plan.code)) {
      yield { kind: "failed", code: plan.code, message: plan.answer };
      return;
    }

    yield {
      kind: "plan",
      sql: plan.sql ?? null,
      answer: plan.answer,
      reasoning: plan.reasoning ?? "",
    };

    if (!plan.sql || !conversationId) {
      yield { kind: "phase", phase: "done" };
      return;
    }

    yield { kind: "phase", phase: "executing" };
    let rows: string;
    try {
      rows = await sample(coordinator, plan.sql);
    } catch (err) {
      yield {
        kind: "failed",
        code: "query_failed",
        message: err instanceof Error ? err.message : "The query did not run.",
      };
      return;
    }
    if (!rows) {
      yield { kind: "phase", phase: "done" };
      return;
    }

    yield { kind: "phase", phase: "explaining" };
    const reading = `Original question: ${question}\n\nSQL executed:\n${plan.sql}\n\nResults (showing first rows):\n${rows}`;
    for await (const frame of api.discovery.askStream(jobId, reading, {
      conversationId,
      provider,
      explain: true,
      signal,
    })) {
      const failure = sseFailure(frame);
      if (failure) {
        yield { kind: "failed", ...failure };
        return;
      }
      if (frame.event === "delta") yield { kind: "explain", text: frame.data };
      else if (frame.event === "complete")
        yield { kind: "explained", text: (JSON.parse(frame.data) as Plan).answer };
    }
    yield { kind: "phase", phase: "done" };
  } catch (err) {
    if (signal.aborted) return;
    yield {
      kind: "failed",
      code: err instanceof ApiError ? err.code : "llm_failed",
      message: err instanceof Error ? err.message : "Ask failed",
    };
  }
}

// ── The rows ─────────────────────────────────────────────────────────────

/**
 * The columns are not known until the model has written its query, so they come
 * out of the result's own shape — the case `ToolOutput` taking children is for.
 */
function ResultTable({ sql }: { sql: string }) {
  const coordinator = useCoordinator();
  // Tagged with the coordinator and SQL it answers: anything else is still
  // loading, so no effect has to blank the previous rows.
  const [result, setResult] = useState<{
    coordinator: Coordinator;
    sql: string;
    rows: ResultRow[];
  } | null>(null);

  useEffect(() => {
    if (!coordinator || !sql) return;
    let cancelled = false;
    const land = (rows: ResultRow[]) => {
      if (!cancelled) setResult({ coordinator, sql, rows });
    };
    coordinator
      .query(sql, { type: "json" })
      .then((rows) => land((rows as ResultRow[]) ?? []))
      .catch(() => land([]));
    return () => {
      cancelled = true;
    };
  }, [coordinator, sql]);

  const fresh = result !== null && result.coordinator === coordinator && result.sql === sql;
  const rows = useMemo(() => (fresh && result ? result.rows : []), [fresh, result]);
  const columns = useMemo<ColumnDef<ResultRow>[]>(
    () =>
      // Not `accessorKey`: a column named with a dot would read as a deep path.
      Object.keys(rows[0] ?? {}).map((key) => ({
        id: key,
        accessorFn: (row: ResultRow) => row[key],
        cell: ({ row }) =>
          row.original[key] == null ? (
            <span className="text-muted-foreground">null</span>
          ) : (
            <span className="font-mono">{String(row.original[key])}</span>
          ),
      })),
    [rows],
  );
  const table = useDataTable({ columns, data: rows, pageSize: 8 });

  if (!fresh) return <Skeleton className="h-20 w-full" />;
  return (
    <DataTableRoot className="gap-2" table={table}>
      <DataTableContent empty="No results" />
      <DataTablePagination />
    </DataTableRoot>
  );
}

// ── The call, and the one answer read three ways ─────────────────────────

type View = "explanation" | "results" | "query";

function ToolCall({ turn, sql }: { turn: Turn; sql: string }) {
  const [view, setView] = useState<View>("explanation");
  const [open, setOpen] = useState<boolean | null>(null);
  const state = toolState(turn);
  const prose = turn.explanation || turn.answer;

  // `Tool`'s self-opening is a `defaultOpen`, read once at mount — and this call
  // is mounted while it is still running, so controlled here, and a reader's own
  // toggle wins from then on.
  return (
    <Tool
      onOpenChange={(details) => setOpen(details.open)}
      open={open ?? (state === "done" || state === "failed")}
      state={state}
    >
      <ToolHeader>query · duckdb</ToolHeader>
      <ToolContent>
        <ToolInput>
          <p className="text-muted-foreground text-xs">Asked of the graph</p>
          <p className="text-sm leading-relaxed">{turn.question}</p>
        </ToolInput>

        <ToolOutput>
          {turn.failure && <ErrorAlert code={turn.failure.code} />}

          <Show when={turn.failure === null}>
            <div className="flex flex-col gap-2">
              {/* Single-select and never empty: three readings of one answer. */}
              <ToggleGroup
                aria-label="How to read the answer"
                multiple={false}
                onValueChange={(details) => {
                  const next = details.value[0] as View | undefined;
                  if (next) setView(next);
                }}
                size="sm"
                value={[view]}
                variant="outline"
              >
                <ToggleGroupItem value="explanation">Explain</ToggleGroupItem>
                <ToggleGroupItem value="results">Results</ToggleGroupItem>
                <ToggleGroupItem value="query">SQL</ToggleGroupItem>
              </ToggleGroup>

              <Show when={view === "explanation"}>
                <Show
                  fallback={<p className="text-muted-foreground text-sm">Reading the rows…</p>}
                  when={prose.length > 0}
                >
                  <MessageMarkdown streaming={turn.phase === "explaining"}>{prose}</MessageMarkdown>
                </Show>
              </Show>

              <Show when={view === "results"}>
                <ResultTable sql={sql} />
              </Show>

              <Show when={view === "query"}>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 pe-10 font-mono text-xs leading-relaxed">
                    {sql}
                  </pre>
                  <Clipboard className="absolute end-1 top-1" value={sql}>
                    <ClipboardTrigger aria-label="Copy the query" />
                  </Clipboard>
                </div>
              </Show>
            </div>
          </Show>
        </ToolOutput>
      </ToolContent>
    </Tool>
  );
}

function Answer({ turn }: { turn: Turn }) {
  return (
    <>
      <TaskList>
        {STEPS.map((step) => (
          <Task key={step.phase} state={stepState(step.phase, turn)}>
            <TaskStatus />
            <TaskTitle>{step.title}</TaskTitle>
          </Task>
        ))}
      </TaskList>

      <Show when={turn.reasoning.length > 0}>
        <Reasoning streaming={turn.phase === "generating"}>
          <ReasoningTrigger />
          <ReasoningContent>{turn.reasoning}</ReasoningContent>
        </Reasoning>
      </Show>

      {turn.sql && <ToolCall sql={turn.sql} turn={turn} />}

      {/* No query at all, so there is no call to fold the answer into. */}
      {turn.sql === null && turn.failure && <ErrorAlert code={turn.failure.code} />}
      {turn.sql === null && turn.failure === null && turn.answer.length > 0 && (
        <MessageMarkdown streaming={turn.phase !== "done"}>{turn.answer}</MessageMarkdown>
      )}
    </>
  );
}

// ── The panel ────────────────────────────────────────────────────────────

interface DiscoveryAskProps {
  jobId: string;
  graphSchema: GraphSchema;
}

export function DiscoveryAsk({ jobId, graphSchema }: DiscoveryAskProps) {
  const coordinator = useCoordinator();
  const engine = useAiStream<AskEvent>();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const nextTurn = useRef(0);
  const live = useRef<number | null>(null);

  const { data: aiProviders, isLoading: loadingAiProviders } = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: api.ai.providers,
  });
  const provider = useMemo(
    () => AI_PROVIDERS.find((p) => aiProviders?.some((s) => s.provider === p.id && s.api_key))?.id,
    [aiProviders],
  );

  // The schema the assistant reasons over: DuckDB's own catalog, read back from
  // the views the corpus mounted. Names, columns and TYPES are the ones a query
  // will actually meet, and the server holds no copy — an ask without it is a 400.
  const [duckSchema, setDuckSchema] = useState<string | null>(null);
  useEffect(() => {
    if (!coordinator) return;
    let cancelled = false;
    describeDataSpace((sql) => coordinator.query(sql, { type: "json" }), graphSchema.edges)
      .then((ddl) => {
        if (!cancelled) setDuckSchema(ddl);
      })
      .catch((err: unknown) => {
        console.error("Failed to read the DuckDB schema", err);
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, graphSchema]);

  const starters = useMemo(() => generateSuggestions(graphSchema), [graphSchema]);
  // Derived from the schema the reader already has, so asking costs nothing and
  // the strip can fill on focus rather than behind a press.
  const suggest = useCallback(
    async function* () {
      for (const value of starters) yield { value };
    },
    [starters],
  );

  const patch = (id: number, event: TurnEvent) =>
    setTurns((prev) => prev.map((turn) => (turn.id === id ? apply(turn, event) : turn)));

  const submit = (asked: string) => {
    const text = asked.trim();
    if (text.length === 0 || duckSchema === null) return;
    const id = nextTurn.current++;
    live.current = id;
    setQuestion("");
    setTurns((prev) => [
      ...prev,
      {
        id,
        question: text,
        phase: "generating",
        reasoning: "",
        sql: null,
        answer: "",
        explanation: "",
        failure: null,
        failedAt: null,
      },
    ]);

    void engine.run(
      (signal) =>
        askTurn({
          jobId,
          question: text,
          conversationId,
          provider,
          schema: duckSchema,
          coordinator,
          signal,
        }),
      (event) => {
        if (event.kind === "conversation") {
          setConversationId(event.id);
          return;
        }
        patch(id, event);
      },
    );
  };

  const stop = () => {
    engine.cancel();
    const id = live.current;
    if (id !== null) patch(id, { kind: "failed", code: "stopped", message: "Stopped." });
  };

  if (!loadingAiProviders && !provider) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Ask" />
        <EmptyState
          icon={AlertCircle}
          title="AI not configured"
          description="An API key is required."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings/ai">Configure</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Ask" />

      <Conversation>
        <ConversationContent className="px-2 py-3">
          <Show when={turns.length === 0}>
            <ConversationEmpty>
              <Sparkles />
              <p>Ask about your data. The ✨ lists a few questions this graph can answer.</p>
            </ConversationEmpty>
          </Show>

          <MessageList>
            {turns.map((turn) => (
              <Fragment key={turn.id}>
                <Message role="user">
                  <MessageContent>{turn.question}</MessageContent>
                </Message>
                <Message role="assistant">
                  <MessageContent>
                    <Answer turn={turn} />
                  </MessageContent>
                </Message>
              </Fragment>
            ))}
          </MessageList>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* `SuggestRoot` wraps the composer: the strip belongs under the whole of
          it, and `PromptInput` IS the `InputGroup` whose recipe selects its own
          direct children. */}
      <div className="shrink-0 px-2 py-1.5">
        <SuggestRoot onPick={submit} suggest={suggest} trigger="focus">
          <PromptInput
            onSubmit={(event) => {
              event.preventDefault();
              if (engine.status === "loading") {
                stop();
                return;
              }
              submit(question);
            }}
          >
            <PromptInputTextarea
              className="resize-none"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={duckSchema === null ? "Reading the schema…" : "Ask about your data…"}
              value={question}
            />
            <PromptInputToolbar>
              <SuggestMark label="Suggest a question" />
              <PromptInputSubmit
                disabled={
                  engine.status !== "loading" &&
                  (question.trim().length === 0 || duckSchema === null)
                }
                status={engine.status}
              />
            </PromptInputToolbar>
          </PromptInput>
          <SuggestList />
        </SuggestRoot>
      </div>
    </div>
  );
}
