"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { SqlCorpus, SqlResult } from "@fossil-lang/corpus";
import {
  Clipboard,
  ClipboardTrigger,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  Show,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
import {
  Conversation,
  ConversationContent,
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
import { $api, ApiError } from "@/lib/api/client";
import { type ChatMessage, completeText, streamText } from "@/lib/ai/stream";
import { explainRequest, parsePlan, queryRequest } from "./query-prompts";
import { generateSuggestions } from "./schema-suggestions";
import { ClientError, type Shown, toProblem } from "@/lib/errors";
import { ProblemView } from "@/components/problem-view";
import { describeDataSpace } from "./data-space";
import { ONCE, recordsOf, useCorpus, useFieldStats } from "./corpus";
import { corpusKey } from "@/lib/fossil/corpus";
import { settled } from "@/lib/api/settled";
import { Finding } from "./finding";
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
  | { kind: "rows"; result: SqlResult }
  | { kind: "explain"; text: string }
  | { kind: "failed"; problem: Shown };

interface Turn {
  id: number;
  question: string;
  phase: Phase;
  reasoning: string;
  sql: string | null;
  answer: string;
  result: SqlResult | null;
  explanation: string;
  failure: Shown | null;
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
    case "failed":
      return { ...turn, failure: event.problem, failedAt: turn.phase };
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

interface AskOptions {
  question: string;
  history: ChatMessage[];
  connection?: string;
  schema: string;
  corpus: SqlCorpus;
  signal: AbortSignal;
}

/** A 64-bit integer comes back as a `bigint`, which JSON cannot carry. */
const plain = (_: string, value: unknown) => (typeof value === "bigint" ? Number(value) : value);

function sample(result: SqlResult): string {
  const json = JSON.stringify(recordsOf({ ...result, rows: result.rows.slice(0, SAMPLE_ROWS) }), plain);
  return json.length > SAMPLE_CHARS ? `${json.slice(0, SAMPLE_CHARS)}...` : json;
}

/**
 * One whole turn as one stream: the model writes a query, DuckDB runs it here,
 * and the rows go back for a reading. A failure is a value rather than a throw,
 * because a turn that broke still belongs in the transcript.
 */
async function* askTurn(options: AskOptions): AsyncIterable<TurnEvent> {
  const { question, history, connection, schema, corpus, signal } = options;
  try {
    const plan = parsePlan(
      await completeText(queryRequest(schema, history, question, connection), signal),
    );
    yield { kind: "plan", ...plan };

    if (!plan.sql) {
      yield { kind: "phase", phase: "done" };
      return;
    }

    yield { kind: "phase", phase: "executing" };
    let result: SqlResult;
    try {
      result = await corpus.sql(plan.sql, { signal });
    } catch (err) {
      yield { kind: "failed", problem: toProblem(err, "query/failed") };
      return;
    }
    yield { kind: "rows", result };

    yield { kind: "phase", phase: "explaining" };
    for await (const text of streamText(
      explainRequest(question, plan.sql, sample(result), connection),
      signal,
    )) {
      yield { kind: "explain", text };
    }
    yield { kind: "phase", phase: "done" };
  } catch (err) {
    if (signal.aborted) return;
    yield { kind: "failed", problem: err instanceof ApiError || err instanceof ClientError ? toProblem(err) : { ...toProblem(err), code: "llm/failed" } };
  }
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
          {turn.failure && <ProblemView problem={turn.failure} />}

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

/** The graph's key column, when the answer carries it: then the answer can be shown on the canvas. */
const KEY = "dense_id";

/** The answer's vertices as something to press — the showcase's `Finding`, as the Rules panel offers. */
function ShowOnGraph({ turn, result }: { turn: Turn; result: SqlResult }) {
  const at = result.columns.indexOf(KEY);
  if (at < 0) return null;
  const ids = [...new Set(result.rows.map((row) => Number(row[at])).filter(Number.isFinite))];
  return (
    <Finding disabled={ids.length === 0} label={turn.question} load={async () => ids} source="ask">
      <span className="flex items-baseline gap-2">
        <span className="flex-1 text-xs leading-relaxed">Show these on the graph</span>
        <span className="shrink-0 font-medium text-xs tabular-nums">
          {ids.length.toLocaleString()}
          {result.truncated ? "+" : ""}
        </span>
      </span>
    </Finding>
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
      {turn.result && turn.phase === "done" && <ShowOnGraph result={turn.result} turn={turn} />}

      {/* No query at all, so there is no call to fold the answer into. */}
      {turn.sql === null && turn.failure && <ProblemView problem={turn.failure} />}
      {turn.sql === null && turn.failure === null && turn.answer.length > 0 && (
        <MessageMarkdown streaming={turn.phase !== "done"}>{turn.answer}</MessageMarkdown>
      )}
    </>
  );
}

// ── The panel ────────────────────────────────────────────────────────────

export function AskPanel() {
  const { jobId, coordinator, corpus, manifest, relation } = useCorpus();
  const tables = useFieldStats();
  const engine = useAiStream<TurnEvent>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const nextTurn = useRef(0);
  const live = useRef<number | null>(null);

  // The model connection the panel asks through: the first there is.
  const models = settled(
    $api.useSuspenseQuery("get", "/v1/connections", { params: { query: { purpose: "model" } } }),
  );
  const connection = models[0]?.name;

  // The schema the assistant reasons over: DuckDB's own catalog, read back from
  // the views the corpus mounted. Names, columns and TYPES are the ones a query
  // will actually meet, and the server holds no copy — an ask without it is a 400.
  // Read before the panel opens, so a question is never sent into a schema still loading.
  const duckSchema = settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(jobId), "data-space"],
      queryFn: () => describeDataSpace((sql) => coordinator.query(sql, { type: "json" }), corpus.url, relation, manifest),
      ...ONCE,
    }),
  );

  const starters = useMemo(() => generateSuggestions(tables, manifest), [tables, manifest]);
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
    if (text.length === 0) return;
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
          question: text,
          history: historyOf(turns),
          connection,
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
    if (id !== null) patch(id, { kind: "failed", problem: { code: "ask/stopped", title: "Stopped.", detail: "" } });
  };

  // Said by its code, with the registry's link to add one, as the server would say it.
  if (!connection) {
    return (
      <ProblemView
        className="p-3"
        problem={{
          code: "llm/not-configured",
          title: "No model connection",
          detail: "Ask writes its queries with a model: add a model credential and a connection on it.",
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation>
        <ConversationContent className="p-3">
          <Show when={turns.length === 0}>
            <EmptyRoot>
              <EmptyHeader>
                <EmptyIndicator>
                  <Sparkles />
                </EmptyIndicator>
                <EmptyDescription className="text-xs">
                  Ask about the graph. Every answer is a query over it — the ✨ lists a few it can answer.
                </EmptyDescription>
              </EmptyHeader>
            </EmptyRoot>
          </Show>

          <MessageList>
            {turns.map((turn) => (
              <Fragment key={turn.id}>
                <Message role="user">
                  <MessageContent className="text-xs">{turn.question}</MessageContent>
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
      <div className="shrink-0 border-t border-border p-2">
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
              className="resize-none text-sm"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about your data…"
              value={question}
            />
            <PromptInputToolbar>
              <SuggestMark label="Suggest a question" />
              <PromptInputSubmit
                disabled={engine.status !== "loading" && question.trim().length === 0}
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
