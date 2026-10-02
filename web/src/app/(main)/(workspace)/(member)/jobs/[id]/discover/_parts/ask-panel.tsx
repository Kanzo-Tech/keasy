"use client";

import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { SqlCorpus } from "@fossil-lang/corpus";
import {
  Clipboard,
  ClipboardTrigger,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  Show,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
import { Chat, type ToolPart, useChat } from "@kanzo-tech/ai";
import { DirectChatTransport } from "@kanzo-tech/llm";
import { corpusKey } from "@/lib/fossil/corpus";
import { toProblem } from "@/lib/errors";
import { ProblemView } from "@/components/problem-view";
import { settled } from "@/lib/api/settled";
import { askAgent, type QueryAnswer, type QueryOutput } from "./ask-agent";
import { describeDataSpace } from "./data-space";
import { ONCE, useCorpus, useFieldStats } from "./corpus";
import { Finding } from "./finding";
import { ResultTable } from "./result-table";
import { generateSuggestions } from "./schema-suggestions";

/** The graph's key column, when the answer carries it: then the answer can be shown on the canvas. */
const KEY = "dense_id";

/** The answer's vertices as something to press — the showcase's `Finding`, as the Rules panel offers. */
function ShowOnGraph({ output }: { output: QueryOutput }) {
  const at = output.columns.indexOf(KEY);
  if (at < 0) return null;
  const ids = [...new Set(output.rows.map((row) => Number(row[at])).filter(Number.isFinite))];
  return (
    <Finding disabled={ids.length === 0} label={output.sql} load={async () => ids} source="ask">
      <span className="flex items-baseline gap-2">
        <span className="flex-1 text-xs leading-relaxed">Show these on the graph</span>
        <span className="shrink-0 font-medium text-xs tabular-nums">
          {ids.length.toLocaleString()}
          {output.truncated ? "+" : ""}
        </span>
      </span>
    </Finding>
  );
}

/** A `query` call's result, read two ways — and, when it carries vertices, put on the canvas. */
function QueryResult({ part }: { part: ToolPart }) {
  const [view, setView] = useState<"results" | "query">("results");
  if (part.state !== "output-available") return null;
  const answer = part.output as QueryAnswer;
  // The engine refused the model's SQL: the agent reads why and tries again; the reader sees it.
  if ("refused" in answer) return <ProblemView problem={answer.refused} />;
  const output = answer;
  return (
    <div className="flex flex-col gap-2">
      {/* Single-select and never empty: two readings of one answer. */}
      <ToggleGroup
        aria-label="How to read the result"
        multiple={false}
        onValueChange={(details) => {
          const next = details.value[0] as typeof view | undefined;
          if (next) setView(next);
        }}
        size="sm"
        value={[view]}
        variant="outline"
      >
        <ToggleGroupItem value="results">Results</ToggleGroupItem>
        <ToggleGroupItem value="query">SQL</ToggleGroupItem>
      </ToggleGroup>
      <Show when={view === "results"}>
        <ResultTable pageSize={8} result={output} />
      </Show>
      <Show when={view === "query"}>
        <div className="relative">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 pe-10 font-mono text-xs leading-relaxed">
            {output.sql}
          </pre>
          <Clipboard className="absolute end-1 top-1" value={output.sql}>
            <ClipboardTrigger aria-label="Copy the query" />
          </Clipboard>
        </div>
      </Show>
      <ShowOnGraph output={output} />
    </div>
  );
}

const TOOLS = { query: (part: ToolPart) => <QueryResult part={part} /> };

/** The conversation, once there is a schema to reason over. One agent for the panel's life. */
function AskChat({ schema, corpus, starters }: { schema: string; corpus: SqlCorpus; starters: string[] }) {
  // What stopped an answer, as thrown: the AI SDK hands `useChat` a sentence, so the transport keeps
  // the value itself for the failure view.
  const [failure, setFailure] = useState<unknown>(undefined);
  const [transport] = useState(
    () =>
      new DirectChatTransport({
        agent: askAgent(schema, corpus),
        onError: (error) => {
          setFailure(error);
          return error instanceof Error ? error.message : String(error);
        },
      }),
  );
  const chat = useChat({ transport });
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* What stopped the answer, by its code: the gateway's refusal, its silence, a broken stream. */}
      {chat.error && <ProblemView className="m-2" problem={toProblem(failure ?? chat.error, "llm/failed")} />}
      <Chat
      chat={chat}
      className="p-2"
      empty={
        <EmptyRoot>
          <EmptyHeader>
            <EmptyIndicator>
              <Sparkles />
            </EmptyIndicator>
            <EmptyDescription className="text-xs">
              Ask about the graph. Every answer is a query over it.
            </EmptyDescription>
          </EmptyHeader>
        </EmptyRoot>
      }
      suggestions={starters}
      tools={TOOLS}
      translations={{ placeholder: "Ask about your data…" }}
    />
    </div>
  );
}

export function AskPanel() {
  const { jobId, coordinator, corpus, manifest } = useCorpus();
  const tables = useFieldStats();

  // The schema the assistant reasons over: DuckDB's own catalog, read back from
  // the views the corpus mounted. Names, columns and TYPES are the ones a query
  // will actually meet. Read before the panel opens; a failure throws to the
  // panel's boundary.
  const schema = settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(jobId), "data-space"],
      queryFn: ({ signal }) =>
        describeDataSpace((sql) => coordinator.query(sql, { type: "json", signal }), corpus, manifest),
      ...ONCE,
    }),
  );

  // Derived from the schema the reader already has, so offering them costs nothing.
  const starters = useMemo(() => generateSuggestions(tables, manifest), [tables, manifest]);
  return <AskChat corpus={corpus} schema={schema} starters={starters} />;
}
