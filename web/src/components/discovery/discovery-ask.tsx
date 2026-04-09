"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Copy,
  Loader2,
  Network,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isTextUIPart, isToolUIPart } from "ai";
import { toast } from "sonner";
import { useCoordinator } from "./use-discovery-store";
import { PanelHeader } from "@/components/layout/workspace-layout";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { allProviders } from "@/lib/ai/providers";
import { generateSuggestions } from "@/lib/schema-suggestions";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import { CodeView } from "@/components/discovery/code-view";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { UIMessage } from "ai";

function ResultTable({ sql: sqlStr }: { sql: string }) {
  const coordinator = useCoordinator();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!coordinator || !sqlStr) return;
    let cancelled = false;
    setLoading(true);
    coordinator.query(sqlStr, { type: "json" })
      .then((result) => { if (!cancelled) setData(Array.isArray(result) ? result : []); })
      .catch(() => { if (!cancelled) setData([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [coordinator, sqlStr]);

  if (loading) return <Skeleton className="h-20 w-full" />;
  if (data.length === 0) return <p className="text-xs text-muted-foreground py-1">No results</p>;

  const columns = Object.keys(data[0]);
  return (
    <div className="max-h-48 overflow-auto rounded-sm border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map(col => <TableHead key={col} className="text-[10px] h-6 whitespace-nowrap">{col}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow key={i}>
              {columns.map(col => (
                <TableCell key={col} className="text-[10px] py-0.5 whitespace-nowrap font-mono">
                  {row[col] == null ? <span className="text-muted-foreground">null</span> : String(row[col])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ToolResultView({ toolArgs, onShowOnGraph }: { toolArgs: Record<string, unknown>; onShowOnGraph?: (sql: string) => void }) {
  const sql = typeof toolArgs.sql === "string" ? toolArgs.sql : undefined;
  const explanation = typeof toolArgs.explanation === "string" ? toolArgs.explanation : undefined;

  const view = useMemo(
    () => explanation ? "explanation" : sql ? "results" : null,
    [explanation, sql],
  );
  const [activeView, setActiveView] = useState(view);
  useEffect(() => { if (view && !activeView) setActiveView(view); }, [view, activeView]);

  if (!explanation && !sql) return null;

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center gap-1">
        <ToggleGroup type="single" variant="outline" size="sm" value={activeView ?? ""} onValueChange={(v) => { if (v) setActiveView(v); }}>
          {explanation && <ToggleGroupItem value="explanation" className="text-[10px] h-5 px-1.5">Explain</ToggleGroupItem>}
          {sql && <ToggleGroupItem value="results" className="text-[10px] h-5 px-1.5">Results</ToggleGroupItem>}
          {sql && <ToggleGroupItem value="query" className="text-[10px] h-5 px-1.5">SQL</ToggleGroupItem>}
        </ToggleGroup>
        {sql && onShowOnGraph && (
          <button className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5" onClick={() => onShowOnGraph(sql)}>
            <Network size={10} /> graph
          </button>
        )}
      </div>

      {activeView === "explanation" && explanation && (
        <Markdown className="text-xs leading-relaxed break-words">{explanation}</Markdown>
      )}
      {activeView === "results" && sql && <ResultTable sql={sql} />}
      {activeView === "query" && sql && (
        <div className="relative">
          <CodeView code={sql} lang="sql" />
          <button className="absolute top-1 right-1 h-5 w-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground" onClick={() => { navigator.clipboard.writeText(sql); toast.success("Copied"); }}>
            <Copy size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ msg, onShowOnGraph }: { msg: UIMessage; onShowOnGraph?: (sql: string) => void }) {
  const { textParts, toolParts } = useMemo(() => ({
    textParts: msg.parts.filter(isTextUIPart),
    toolParts: msg.parts.filter(isToolUIPart),
  }), [msg.parts]);

  const hasContent = textParts.length > 0 || toolParts.length > 0;

  return (
    <div className="space-y-1.5">
      {textParts.map((part, i) => (
        <Markdown key={i} className="text-xs leading-relaxed break-words">{part.text}</Markdown>
      ))}
      {toolParts.map((part) => (
        <ToolResultView
          key={part.toolCallId}
          toolArgs={"args" in part ? (part.args as Record<string, unknown>) : {}}
          onShowOnGraph={onShowOnGraph}
        />
      ))}
      {!hasContent && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
          Thinking...
        </div>
      )}
    </div>
  );
}

interface DiscoveryAskProps {
  schema: string;
  graphSchema: import("@/lib/graph-schema").GraphSchema;
  onShowOnGraph?: (sql: string) => void;
}

export function DiscoveryAsk({ schema: duckSchema, graphSchema, onShowOnGraph }: DiscoveryAskProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const schemaReady = duckSchema.length > 0;

  const { data: aiProviders, isLoading: loadingAiProviders } = useQuery({ queryKey: queryKeys.ai.providers, queryFn: api.ai.providers });
  const connectedProviders = useMemo(
    () => allProviders.filter((p) => aiProviders?.some((s) => s.provider === p.id && s.api_key)),
    [aiProviders],
  );
  const aiConfigured = connectedProviders.length > 0;
  const topSuggestions = useMemo(() => generateSuggestions(graphSchema).slice(0, 4), [graphSchema]);

  useEffect(() => {
    if (connectedProviders.length > 0 && !selectedProvider) setSelectedProvider(connectedProviders[0].id);
  }, [connectedProviders, selectedProvider]);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { provider: selectedProvider, schema: duckSchema },
    }),
    [selectedProvider, duckSchema],
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  function handleSend(text: string) {
    if (!text.trim() || isLoading || !schemaReady) return;
    setInput("");
    sendMessage({ text });
  }

  if (!loadingAiProviders && !aiConfigured) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="Ask" />
        <EmptyState icon={AlertCircle} title="AI not configured" description="An API key is required." action={<Button variant="outline" size="sm" asChild><Link href="/settings/ai">Configure</Link></Button>} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Ask" />

      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-2 space-y-3">
          {messages.length === 0 && (
            <div className="py-6 text-center space-y-3">
              <Sparkles size={20} className="mx-auto text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Ask about your data</p>
              <div className="flex flex-wrap gap-1 justify-center">
                {topSuggestions.map((s, i) => (
                  <button key={i} className="text-[10px] px-2 py-0.5 rounded-full border text-muted-foreground hover:text-foreground hover:bg-accent" onClick={() => handleSend(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : ""}>
              {msg.role === "user" ? (
                <div className="bg-muted rounded-lg px-2.5 py-1.5 text-xs max-w-[85%]">
                  {msg.parts.filter(isTextUIPart).map((p, i) => <span key={i}>{p.text}</span>)}
                </div>
              ) : (
                <AssistantMessage msg={msg} onShowOnGraph={onShowOnGraph} />
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="shrink-0 px-2 py-1.5 space-y-1.5">
        {connectedProviders.length > 1 && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={selectedProvider}
            onValueChange={(v) => { if (v) setSelectedProvider(v); }}
          >
            {connectedProviders.map((p) => {
              const Icon = p.icon;
              return (
                <ToggleGroupItem key={p.id} value={p.id} className="text-[10px] h-5 px-1.5 gap-1">
                  <Icon className="h-3 w-3" />
                  {p.name}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        )}
        <InputGroup className="rounded-lg">
          <InputGroupTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
            placeholder={schemaReady ? "Ask about your data..." : "Preparing schema..."}
            disabled={isLoading || !schemaReady}
            rows={1}
          />
          <InputGroupAddon align="block-end">
            <Button
              size="icon"
              className="h-7 w-7 rounded-md"
              disabled={!input.trim() || isLoading || !schemaReady}
              onClick={() => handleSend(input)}
            >
              <ArrowUp size={14} />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
}
