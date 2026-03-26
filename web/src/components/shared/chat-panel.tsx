"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  MessageSquarePlus,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditableText } from "@/components/ui/editable-text";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { SidebarContentLayout } from "@/components/layout/sidebar-content-layout";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComponentType } from "react";

// ── Types ────────────────────────────────────────────────────────────────

export interface ChatConversation {
  id: string;
  title?: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Optional phase label shown during loading */
  phase?: string;
  /** Whether this message is still loading */
  loading?: boolean;
  /** Arbitrary extra content rendered after the message body */
  extra?: React.ReactNode;
}

export interface ChatProvider {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface ChatPanelProps {
  // Conversation management
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;

  // Messages
  messages: ChatMessage[];
  loading: boolean;

  // Send
  onSend: (question: string) => void;

  // Dynamic suggestions (programmatic from schema)
  suggestions?: string[];

  // Optional: provider selector
  providers?: ChatProvider[];
  selectedProvider?: string;
  onProviderChange?: (id: string) => void;

  // Placeholder text
  emptyTitle?: string;
  emptyDescription?: string;
  inputPlaceholder?: string;
}

// ── Message bubble ──────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return <div className="text-sm break-words">{msg.content}</div>;
  }

  // Assistant loading state
  if (msg.loading) {
    return (
      <div className="space-y-2 py-1">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        {msg.phase && (
          <span className="text-xs text-muted-foreground">{msg.phase}</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 min-w-0">
      {msg.content && (
        <div className="text-sm leading-relaxed break-words">{msg.content}</div>
      )}
      {msg.extra}
    </div>
  );
}

// ── Conversation sidebar ─────────────────────────────────────────────────

function ConversationList({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
}: Pick<
  ChatPanelProps,
  | "conversations"
  | "activeConversationId"
  | "onSelectConversation"
  | "onNewConversation"
  | "onRenameConversation"
  | "onDeleteConversation"
>) {
  return (
    <div className="flex flex-col min-h-0 h-full p-3">
      <Button
        variant="outline"
        size="sm"
        className="w-full mb-2 justify-start gap-2"
        onClick={onNewConversation}
      >
        <MessageSquarePlus size={14} />
        New chat
      </Button>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-muted",
                activeConversationId === c.id
                  ? "bg-muted font-medium"
                  : "text-muted-foreground",
              )}
              onClick={() => onSelectConversation(c.id)}
            >
              <EditableText
                className="flex-1 min-w-0 text-xs truncate"
                value={c.title || new Date(c.created_at).toLocaleDateString()}
                onSave={(title) => onRenameConversation(c.id, title)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConversation(c.id);
                }}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────

export function ChatPanel({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  messages,
  loading,
  onSend,
  suggestions,
  providers,
  selectedProvider,
  onProviderChange,
  emptyTitle = "Ask about your data",
  emptyDescription = "The AI generates a query, executes it, and explains the results.",
  inputPlaceholder = "Ask a question...",
}: ChatPanelProps) {
  const [question, setQuestion] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lastMsgId = messages[messages.length - 1]?.id;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMsgId]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [question]);

  function handleSubmit(text?: string) {
    const q = (text ?? question).trim();
    if (!q || loading) return;
    setQuestion("");
    onSend(q);
  }

  const sidebar = (
    <ConversationList
      conversations={conversations}
      activeConversationId={activeConversationId}
      onSelectConversation={onSelectConversation}
      onNewConversation={onNewConversation}
      onRenameConversation={onRenameConversation}
      onDeleteConversation={onDeleteConversation}
    />
  );

  return (
    <SidebarContentLayout nav={sidebar} asideClassName="w-48 min-w-48 max-w-48 border-r">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {messages.length === 0 ? (
            <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col items-center justify-center h-full">
              <EmptyState
                icon={MessageCircle}
                title={emptyTitle}
                description={emptyDescription}
                action={suggestions && suggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-2 max-w-md justify-center">
                    {suggestions.map((q) => (
                      <Button
                        key={q}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleSubmit(q)}
                      >
                        {q}
                      </Button>
                    ))}
                  </div>
                ) : undefined}
              />
            </div>
          ) : (
            <div className="max-w-2xl mx-auto w-full">
              {messages.map((msg) => (
                <div key={msg.id} className="flex gap-3 py-3">
                  <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-muted mt-0.5">
                    {msg.role === "user" ? <User size={14} /> : <Sparkles size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      {msg.role === "user" ? "You" : "AI"}
                    </p>
                    <MessageBubble msg={msg} />
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="px-3">
          <form
            className="max-w-2xl mx-auto w-full"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <InputGroup className="rounded-xl">
              <InputGroupTextarea
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={inputPlaceholder}
                disabled={loading}
                rows={1}
              />
              <InputGroupAddon align="block-end">
                {providers && providers.length > 0 && onProviderChange && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-full gap-1.5 text-xs"
                      >
                        {(() => {
                          const p = providers.find(
                            (p) => p.id === selectedProvider,
                          );
                          if (!p) return "Select model";
                          const Icon = p.icon;
                          return (
                            <>
                              <Icon className="h-3.5 w-3.5" />
                              {p.label}
                            </>
                          );
                        })()}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {providers.map((p) => {
                        const Icon = p.icon;
                        return (
                          <DropdownMenuItem
                            key={p.id}
                            onClick={() => onProviderChange!(p.id)}
                            className="gap-2"
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {p.label}
                            {selectedProvider === p.id && (
                              <Check className="h-3.5 w-3.5 ml-auto" />
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button
                  type="submit"
                  size="icon"
                  className="rounded-full ml-auto h-8 w-8"
                  disabled={loading || !question.trim()}
                >
                  <ArrowUp size={14} />
                </Button>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </div>
      </div>
    </SidebarContentLayout>
  );
}
