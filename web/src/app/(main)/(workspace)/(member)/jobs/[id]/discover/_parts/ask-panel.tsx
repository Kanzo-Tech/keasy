"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ExecuteSqlResult, SqlCorpus } from "@fossil-lang/corpus";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Clipboard,
  ClipboardTrigger,
  Item,
  ItemActions,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Show,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
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
import { ApiError, api } from "@/lib/api";
import { sseFailure } from "@/lib/api/sse";
import { queryKeys } from "@/lib/query-keys";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { generateSuggestions } from "@/lib/schema-suggestions";
import { getErrorInfo } from "@/lib/error-codes";
import type { GraphSchema } from "@/lib/graph-schema";
import type { AiProvider, ChatMessage } from "@/lib/types";
import { describeDataSpace } from "@/lib/data-space";
import { useCorpus } from "./corpus";
import { ResultTable } from "./result-table";

// ── The turn ─────────────────────────────────────────────────────────────

type Phase = "generating" | "executing" | "explaining" | "done";

const ORDER: Phase[] = ["generating", "executing", "explaining", "done"];

const STEPS = [
  { phase: "generating", title: "Write a query" },
  { phase: "executing", title: "Run it over the graph" },
  { phase: "explaining", title: "Read the rows back" },
] as const satisfies readonly { phase: Phase; title: string }[];

type TurnEvent =
  | { kind: "phase"; phase: Phase }
  | { kind: "plan"; sql: string | null; answer: string; reasoning: string }
  | { kind: "rows"; result: ExecuteSqlResult }
  | { kind: "explain"; text: string }
  | { kind: "explained"; text: string }
  | { kind: "failed"; code: string };

interface Turn {
  id: number;
  question: string;
  phase: Phase;
  reasoning: string;
  sql: string | null;
  answer: string;
  result: ExecuteSqlResult | null;
  explanation: string;
  failure: string | null;
  /** The phase the run stopped in, which is the step that wears the failure. */
  failedAt: Phase | null;
}

function apply(turn: Turn, event: TurnEvent): Turn {
  switch (event.kind) {
    case "phase":
      return { ...turn, phase: event.phase };
    case "plan":
      return { ...turn, sql: event.sql, answer: event.answer, reasoning: event.reasoning };
    case "rows":
      return { ...turn, result: event.result };
    case "explain":
      return { ...turn, explanation: turn.explanation + event.text };
    case "explained":
      return { ...turn, explanation: event.text };
    case "failed":
      return { ...turn, failure: event.code, failedAt: turn.phase };
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

/** The conversation as the model reads it back: every finished turn, question then answer. */
function historyOf(turns: Turn[]): ChatMessage[] {
  return turns
    .filter((turn) => turn.phase === "done" && turn.failure === null)
    .flatMap((turn): ChatMessage[] => [
      { role: "user", content: turn.question },
      {
        role: "assistant",
        content: turn.sql
          ? `${turn.explanation || turn.answer}\n\nSQL: ${turn.sql}`
          : turn.answer,
      },
    ]);
}

function toolState(turn: Turn): RunState {
  if (turn.failure) return "failed";
  return turn.phase === "done" ? "done" : "running";
}

// ── The source ───────────────────────────────────────────────────────────

/** How much of the result set the model is shown before it reads the rows back. */
const SAMPLE_ROWS = 30;
const SAMPLE_CHARS = 4000;

interface Plan {
  sql?: string;
  answer: string;
  reasoning?: string;
}

interface AskOptions {
  jobId: string;
  question: string;
  history: ChatMessage[];
  provider?: AiProvider;
  schema?: string;
  corpus: SqlCorpus;
  signal: AbortSignal;
}

function sample(result: ExecuteSqlResult): string {
  const json = JSON.stringify(result.rows.slice(0, SAMPLE_ROWS));
  return json.length > SAMPLE_CHARS ? `${json.slice(0, SAMPLE_CHARS)}...` : json;
}

/**
 * One whole turn as one stream: the model writes a query, DuckDB runs it here,
 * and the rows go back for a reading. A failure is a value rather than a throw,
 * because a turn that broke still belongs in the transcript.
 */
async function* askTurn(options: AskOptions): AsyncIterable<TurnEvent> {
  const { jobId, question, history, provider, schema, corpus, signal } = options;
  try {
    let plan: Plan | null = null;

    for await (const frame of api.discovery.askStream(jobId, question, {
      provider,
      schema,
      history,
      signal,
    })) {
      const failure = sseFailure(frame);
      if (failure) {
        yield { kind: "failed", code: failure.code };
        return;
      }
      if (frame.event === "complete") {
        plan = JSON.parse(frame.data) as Plan;
      }
    }

    if (!plan) {
      yield { kind: "phase", phase: "done" };
      return;
    }

    yield {
      kind: "plan",
      sql: plan.sql ?? null,
      answer: plan.answer,
      reasoning: plan.reasoning ?? "",
    };

    if (!plan.sql) {
      yield { kind: "phase", phase: "done" };
      return;
    }

    yield { kind: "phase", phase: "executing" };
    let result: ExecuteSqlResult;
    try {
      result = await corpus.executeSql({ sql: plan.sql });
    } catch {
      yield { kind: "failed", code: "query_failed" };
      return;
    }
    yield { kind: "rows", result };

    yield { kind: "phase", phase: "explaining" };
    const reading = `Original question: ${question}\n\nSQL executed:\n${plan.sql}\n\nResults (showing first rows):\n${sample(result)}`;
    for await (const frame of api.discovery.askStream(jobId, reading, {
      provider,
      explain: true,
      signal,
    })) {
      const failure = sseFailure(frame);
      if (failure) {
        yield { kind: "failed", code: failure.code };
        return;
      }
      if (frame.event === "delta") yield { kind: "explain", text: frame.data };
      else if (frame.event === "complete")
        yield { kind: "explained", text: (JSON.parse(frame.data) as Plan).answer };
    }
    yield { kind: "phase", phase: "done" };
  } catch (err) {
    if (signal.aborted) return;
    yield { kind: "failed", code: err instanceof ApiError ? err.code : "llm_failed" };
  }
}

// ── The call, and the one answer read three ways ─────────────────────────

function Failure({ code }: { code: string }) {
  const { message, link } = getErrorInfo(code);
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{message}</AlertTitle>
      {link && (
        <AlertDescription>
          <Button asChild className="w-fit" size="sm" variant="outline">
            <Link href={link.href}>{link.label}</Link>
          </Button>
        </AlertDescription>
      )}
    </Alert>
  );
}

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
          {turn.failure && <Failure code={turn.failure} />}

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
                {turn.result ? (
                  <ResultTable pageSize={8} result={turn.result} />
                ) : (
                  <Skeleton className="h-20 w-full" />
                )}
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
      {turn.sql === null && turn.failure && <Failure code={turn.failure} />}
      {turn.sql === null && turn.failure === null && turn.answer.length > 0 && (
        <MessageMarkdown streaming={turn.phase !== "done"}>{turn.answer}</MessageMarkdown>
      )}
    </>
  );
}

// ── The panel ────────────────────────────────────────────────────────────

export function AskPanel({ jobId, graphSchema }: { jobId: string; graphSchema: GraphSchema }) {
  const { coordinator, corpus } = useCorpus();
  const engine = useAiStream<TurnEvent>();
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
        result: null,
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
          history: historyOf(turns),
          provider,
          schema: duckSchema,
          corpus,
          signal,
        }),
      (event) => patch(id, event),
    );
  };

  const stop = () => {
    engine.cancel();
    const id = live.current;
    if (id !== null) patch(id, { kind: "failed", code: "stopped" });
  };

  if (!loadingAiProviders && !provider) {
    return (
      <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
        <ItemMedia className="text-muted-foreground" variant="icon">
          <AlertCircle />
        </ItemMedia>
        <ItemTitle>AI not configured</ItemTitle>
        <ItemDescription>An API key is required.</ItemDescription>
        <ItemActions>
          <Button asChild size="sm" variant="outline">
            <Link href="/settings/ai">Configure</Link>
          </Button>
        </ItemActions>
      </Item>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
