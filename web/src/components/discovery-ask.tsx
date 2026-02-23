"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  MessageSquarePlus,
  Send,
  Trash2,
} from "lucide-react";
import useSWR from "swr";
import {
  ApiError,
  askDiscover,
  listConversations,
  getMessages,
  renameConversation,
  deleteConversation,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EditableText } from "@/components/ui/editable-text";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CodeView } from "@/components/code-view";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Markdown } from "@/components/ui/markdown";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isError } from "@/lib/error-codes";
import type {
  Conversation,
  ConversationMessage,
} from "@/lib/types";

interface DiscoveryAskProps {
  jobId: string;
}

function MessageEntry({ msg }: { msg: ConversationMessage }) {
  const [showSparql, setShowSparql] = useState(false);

  if (msg.role === "user") {
    return <div className="text-sm font-medium break-words">{msg.content}</div>;
  }

  const hasError = isError(msg.code);
  const hasData = msg.data && msg.data.rows.length > 0;
  const hasEmptyData = msg.data && msg.data.rows.length === 0;

  if (hasError) {
    return (
      <div className="space-y-2 min-w-0">
        <ErrorAlert code={msg.code!} />
        {msg.sparql && <CodeView code={msg.sparql} lang="sparql" />}
      </div>
    );
  }

  if (hasEmptyData) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
        <AlertCircle size={12} className="shrink-0" />
        No matching data found. Try rephrasing your question.
      </div>
    );
  }

  return (
    <div className="space-y-2 min-w-0">
      {msg.content && (
        <Markdown className="text-sm leading-relaxed break-words">{msg.content}</Markdown>
      )}

      {(hasData || msg.sparql) && (
        <div className="space-y-1.5">
          {hasData && msg.sparql && (
            <ToggleGroup
              type="single"
              size="sm"
              value={showSparql ? "sparql" : "results"}
              onValueChange={(v) => { if (v) setShowSparql(v === "sparql"); }}
            >
              <ToggleGroupItem value="results" className="text-[11px] h-6 px-2">
                Results
              </ToggleGroupItem>
              <ToggleGroupItem value="sparql" className="text-[11px] h-6 px-2">
                SPARQL
              </ToggleGroupItem>
            </ToggleGroup>
          )}

          {!showSparql && hasData && (
            <div className="max-h-60 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {msg.data!.columns.map((col) => (
                      <TableHead key={col} className="text-xs h-8">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {msg.data!.rows.map((row, ri) => (
                    <TableRow key={ri}>
                      {msg.data!.columns.map((col) => (
                        <TableCell key={col} className="text-xs py-1.5">
                          {String(row[col] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {(showSparql || (!hasData && msg.sparql)) && msg.sparql && (
            <CodeView code={msg.sparql} lang="sparql" />
          )}
        </div>
      )}
    </div>
  );
}

export function DiscoveryAsk({ jobId }: DiscoveryAskProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: initialConversations, isLoading: loadingConversations, mutate: mutateConversations } = useSWR(
    `conversations-${jobId}`,
    () => listConversations(jobId),
  );

  useEffect(() => {
    if (initialConversations) {
      setConversations(initialConversations);
      if (initialConversations.length > 0) {
        setActiveConversationId((prev) => prev ?? initialConversations[0].id);
      }
    }
  }, [initialConversations]);

  const { data: loadedMessages } = useSWR(
    activeConversationId ? `messages-${activeConversationId}` : null,
    () => getMessages(activeConversationId!),
  );

  useEffect(() => {
    if (loadedMessages) setMessages(loadedMessages);
    else if (!activeConversationId) setMessages([]);
  }, [loadedMessages, activeConversationId]);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function startNewConversation() {
    setActiveConversationId(null);
    setMessages([]);
  }

  async function handleRenameBlur(conversationId: string, newTitle: string) {
    const trimmed = newTitle.trim();
    const prev = conversations.find((c) => c.id === conversationId);
    if (!trimmed || trimmed === (prev?.title ?? "")) return;
    setConversations((cs) =>
      cs.map((c) => (c.id === conversationId ? { ...c, title: trimmed } : c)),
    );
    try {
      await renameConversation(conversationId, trimmed);
    } catch {
      setConversations((cs) =>
        cs.map((c) => (c.id === conversationId ? { ...c, title: prev?.title } : c)),
      );
    }
  }

  async function handleDelete(conversationId: string) {
    try {
      await deleteConversation(conversationId);
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch {
    }
  }

  async function handleAsk() {
    const q = question.trim();
    if (!q) return;
    setQuestion("");
    setLoading(true);

    const userMsg: ConversationMessage = {
      id: crypto.randomUUID(),
      conversation_id: activeConversationId ?? "",
      role: "user",
      content: q,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const response = await askDiscover(
        jobId,
        q,
        activeConversationId ?? undefined,
      );
      if (!activeConversationId && response.conversation_id) {
        setActiveConversationId(response.conversation_id);
        setConversations((prev) => {
          if (prev.find((c) => c.id === response.conversation_id)) return prev;
          return [
            {
              id: response.conversation_id!,
              job_id: jobId,
              created_at: new Date().toISOString(),
              title: q.slice(0, 60),
            },
            ...prev,
          ];
        });
        mutateConversations();
      }
      const assistantMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        conversation_id: response.conversation_id ?? activeConversationId ?? "",
        role: "assistant",
        content: response.answer,
        sparql: response.sparql,
        data: response.data,
        code: response.code,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const assistantMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        conversation_id: activeConversationId ?? "",
        role: "assistant",
        content: err instanceof Error ? err.message : "Ask failed",
        code: err instanceof ApiError ? err.code : "UNKNOWN",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex min-h-0 gap-3">
      <div className="w-48 shrink-0 flex flex-col min-h-0 border-r pr-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full mb-2 justify-start gap-2"
          onClick={startNewConversation}
        >
          <MessageSquarePlus size={14} />
          New chat
        </Button>
        <ScrollArea className="flex-1">
          {loadingConversations && (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
            </div>
          )}
          <div className="space-y-0.5">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-muted ${
                  activeConversationId === c.id
                    ? "bg-muted font-medium"
                    : "text-muted-foreground"
                }`}
                onClick={() => setActiveConversationId(c.id)}
              >
                <EditableText
                  className="flex-1 min-w-0 text-xs truncate"
                  value={c.title || new Date(c.created_at).toLocaleDateString()}
                  onSave={(title) => handleRenameBlur(c.id, title)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(c.id);
                  }}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <div className="flex-1 overflow-y-auto space-y-4 mb-3 min-w-0">
          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Ask a question about your data. The AI will generate a SPARQL
              query and return results.
            </div>
          )}
          {messages.map((msg) => (
            <MessageEntry key={msg.id} msg={msg} />
          ))}
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-20 w-full rounded-md" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about your data..."
            disabled={loading}
            className="flex-1"
          />
          <Button
            type="submit"
            size="sm"
            disabled={loading || !question.trim()}
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
