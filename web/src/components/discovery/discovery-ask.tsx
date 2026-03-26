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
import { toast } from "sonner";
import { useCoordinator } from "./use-discovery-store";
import { PanelHeader } from "@/components/layout/workspace-layout";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { generateSuggestions } from "@/lib/schema-suggestions";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import { CodeView } from "@/components/discovery/code-view";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { isError } from "@/lib/error-codes";
import { createDiscoveryAskStore as createAskStore } from "./discovery-ask-store";
import type { ConversationMessage } from "@/lib/types";

// ── Types ────────────────────────────────────────────────────────────────

interface AskMessage extends ConversationMessage {
  reasoning?: string;
  explanation?: string;
  phase?: "generating" | "executing" | "explaining" | "done";
}

// ── ResultTable ──────────────────────────────────────────────────────────

function ResultTable({ sql: sqlStr }: { sql: string }) {
  const coordinator = useCoordinator();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!coordinator || !sqlStr) return;
    let cancelled = false;
    setLoading(true);
    coordinator.query(sqlStr, { type: "json" })
      .then((result) => { if (!cancelled) setData((result as Record<string, unknown>[]) ?? []); })
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

// ── AssistantExtra ───────────────────────────────────────────────────────

function AssistantExtra({ msg, onShowOnGraph }: { msg: AskMessage; onShowOnGraph?: (sql: string) => void }) {
  const hasError = isError(msg.code ?? undefined);
  const hasExplanation = !!msg.explanation;
  const hasSql = !!msg.sql;
  const hasContent = hasExplanation || !!msg.content;

  const defaultView = hasContent ? "explanation" : hasSql ? "results" : null;
  const [view, setView] = useState(defaultView);

  useEffect(() => {
    if (!view && hasContent) setView("explanation");
    else if (!view && hasSql) setView("results");
  }, [view, hasContent, hasSql]);

  if (hasError) return <ErrorAlert code={msg.code!} />;
  if (!hasContent && !hasSql) return null;

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center gap-1">
        <ToggleGroup type="single" variant="outline" size="sm" value={view ?? ""} onValueChange={(v) => { if (v) setView(v); }}>
          {hasContent && <ToggleGroupItem value="explanation" className="text-[10px] h-5 px-1.5">Explain</ToggleGroupItem>}
          {hasSql && <ToggleGroupItem value="results" className="text-[10px] h-5 px-1.5">Results</ToggleGroupItem>}
          {hasSql && <ToggleGroupItem value="query" className="text-[10px] h-5 px-1.5">SQL</ToggleGroupItem>}
        </ToggleGroup>
        {hasSql && onShowOnGraph && (
          <button className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5" onClick={() => onShowOnGraph(msg.sql!)}>
            <Network size={10} /> graph
          </button>
        )}
      </div>

      {view === "explanation" && hasContent && (
        <Markdown className="text-xs leading-relaxed break-words">{msg.explanation || msg.content}</Markdown>
      )}
      {view === "results" && hasSql && <ResultTable sql={msg.sql!} />}
      {view === "query" && hasSql && (
        <div className="relative">
          <CodeView code={msg.sql!} lang="sql" />
          <button className="absolute top-1 right-1 h-5 w-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground" onClick={() => { navigator.clipboard.writeText(msg.sql!); toast.success("Copied"); }}>
            <Copy size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────

interface DiscoveryAskProps {
  jobId: string;
  schema: string;
  graphSchema: import("@/lib/graph-schema").GraphSchema;
  onShowOnGraph?: (sql: string) => void;
}

export function DiscoveryAsk({ jobId, schema: duckSchema, graphSchema, onShowOnGraph }: DiscoveryAskProps) {
  const coordinator = useCoordinator();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  // Zustand store — persistent across re-renders, scoped per component instance
  const storeRef = useRef<ReturnType<typeof createAskStore>>(undefined);
  if (!storeRef.current) storeRef.current = createAskStore();
  const store = storeRef.current;
  const messages = store((s) => s.messages);
  const loading = store((s) => s.loading);
  const conversationId = store((s) => s.conversationId);
  const selectedProvider = store((s) => s.selectedProvider);

  const { data: aiProviders, isLoading: loadingAiProviders } = useQuery({ queryKey: queryKeys.ai.providers, queryFn: api.ai.providers });
  const connectedProviders = useMemo(
    () => AI_PROVIDERS.filter((p) => aiProviders?.some((s) => s.provider === p.id && s.api_key)),
    [aiProviders],
  );
  const aiConfigured = connectedProviders.length > 0;
  const suggestions = useMemo(() => generateSuggestions(graphSchema), [graphSchema]);

  useEffect(() => {
    if (connectedProviders.length > 0 && !selectedProvider) store.getState().setSelectedProvider(connectedProviders[0].id);
  }, [connectedProviders, selectedProvider, store]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleSend(q: string) {
    if (!q.trim() || loading) return;
    const s = store.getState();
    s.setLoading(true);
    setInput("");

    s.addUserMessage(q);
    const assistantId = s.addPlaceholder();
    const update = (patch: Record<string, unknown>) => s.updateMessage(assistantId, patch);

    let convId = conversationId;

    try {
      for await (const { event, data } of api.discovery.askStream(jobId, q, {
        conversationId: conversationId ?? undefined,
        provider: selectedProvider || undefined,
        schema: duckSchema,
      })) {
        if (event === "conversation") {
          const { conversation_id: newId } = JSON.parse(data);
          if (!conversationId && newId) { convId = newId; store.getState().setConversationId(newId); }
        } else if (event === "complete") {
          const result = JSON.parse(data) as { sql?: string; answer: string; conversation_id: string; reasoning?: string; code: string };
          update({ sql: result.sql, content: result.answer, code: result.code, reasoning: result.reasoning, phase: "executing" });

          if (result.sql && convId) {
            update({ phase: "explaining" });
            let sampleRows = "";
            if (coordinator) {
              try {
                const rows = await coordinator.query(result.sql, { type: "json" });
                const arr = (rows as Record<string, unknown>[]) ?? [];
                sampleRows = JSON.stringify(arr.slice(0, 30));
                if (sampleRows.length > 4000) sampleRows = sampleRows.slice(0, 4000) + "...";
              } catch {}
            }
            if (sampleRows) {
              const explainQ = `Original question: ${q}\n\nSQL executed:\n${result.sql}\n\nResults (showing first rows):\n${sampleRows}`;
              let explainText = "";
              let rafPending = false;
              for await (const { event: ev, data: d } of api.discovery.askStream(jobId, explainQ, { conversationId: convId ?? undefined, provider: selectedProvider || undefined, explain: true })) {
                if (ev === "delta") {
                  explainText += d;
                  if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; update({ explanation: explainText }); }); }
                } else if (ev === "complete") {
                  const r = JSON.parse(d) as { answer: string };
                  update({ explanation: r.answer, phase: "done" });
                }
              }
            } else { update({ phase: "done" }); }
          } else { update({ phase: "done" }); }
        } else if (event === "error") {
          const err = JSON.parse(data) as { code: string; answer: string };
          update({ content: err.answer, code: err.code, phase: "done" });
        }
      }
    } catch (err) {
      update({ content: err instanceof Error ? err.message : "Ask failed", code: err instanceof ApiError ? err.code : "UNKNOWN", phase: "done" });
    } finally {
      store.getState().setLoading(false);
    }
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

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-2 space-y-3">
          {messages.length === 0 && (
            <div className="py-6 text-center space-y-3">
              <Sparkles size={20} className="mx-auto text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Ask about your data</p>
              <div className="flex flex-wrap gap-1 justify-center">
                {suggestions.slice(0, 4).map((s, i) => (
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
                <div className="bg-muted rounded-lg px-2.5 py-1.5 text-xs max-w-[85%]">{msg.content}</div>
              ) : (
                <div className="space-y-1.5">
                  {msg.phase && msg.phase !== "done" && !msg.explanation && !msg.content && !msg.sql && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 size={12} className="animate-spin" />
                      {msg.phase === "executing" ? "Executing..." : msg.phase === "explaining" ? "Analyzing..." : "Thinking..."}
                    </div>
                  )}
                  <AssistantExtra msg={msg} onShowOnGraph={onShowOnGraph} />
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="shrink-0 px-2 py-1.5">
        <InputGroup className="rounded-lg">
          <InputGroupTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
            placeholder="Ask about your data..."
            disabled={loading}
            rows={1}
          />
          <InputGroupAddon align="block-end">
            <Button
              size="icon"
              className="h-7 w-7 rounded-md"
              disabled={!input.trim() || loading}
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
