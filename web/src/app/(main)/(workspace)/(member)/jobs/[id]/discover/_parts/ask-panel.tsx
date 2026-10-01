"use client";

import { useEffect, useMemo, useState } from "react";
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
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
import { Chat, type ToolPart, useChat } from "@kanzo-tech/ai";
import { DirectChatTransport } from "@kanzo-tech/llm";
import { type Shown, toProblem } from "@/lib/errors";
import { ProblemView } from "@/components/problem-view";
import { askAgent, type QueryOutput } from "./ask-agent";
import { describeDataSpace } from "./data-space";
import { useCorpus, useFieldStats } from "./corpus";
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
  const output = part.output as QueryOutput;
  const [view, setView] = useState<"results" | "query">("results");
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
  const [transport] = useState(() => new DirectChatTransport({ agent: askAgent(schema, corpus) }));
  const chat = useChat({ transport });
  return (
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
  );
}

export function AskPanel() {
  const { coordinator, corpus, manifest, relation } = useCorpus();
  const { tables } = useFieldStats();

  // The schema the assistant reasons over: DuckDB's own catalog, read back from
  // the views the corpus mounted. Names, columns and TYPES are the ones a query
  // will actually meet.
  const [schema, setSchema] = useState<string | null>(null);
  const [problem, setProblem] = useState<Shown | null>(null);
  useEffect(() => {
    let cancelled = false;
    describeDataSpace((sql) => coordinator.query(sql, { type: "json" }), corpus.url, relation, manifest)
      .then((ddl) => {
        if (!cancelled) setSchema(ddl);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(toProblem(err));
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, corpus, relation, manifest]);

  // Derived from the schema the reader already has, so offering them costs nothing.
  const starters = useMemo(() => generateSuggestions(tables, manifest), [tables, manifest]);

  if (problem) return <ProblemView problem={problem} />;
  if (schema === null) {
    return (
      <div className="flex flex-col gap-2 p-3" aria-label="Reading the schema…">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  return <AskChat corpus={corpus} schema={schema} starters={starters} />;
}
