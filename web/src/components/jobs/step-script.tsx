"use client";

import { useRef, useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/layout/page-shell";
import {
  CodeEditor,
  fossilLanguage,
  fossilAutocomplete,
  fossilLinterExtension,
} from "@/components/discovery/code-editor";
import { AssistantWizard } from "@/components/jobs/assistant-wizard";
import { ArrowLeft, ArrowRight, Save, Loader2 } from "lucide-react";
import type { Connector, ProviderInfo, FileEntry, FossilCompletionItem, CreationMode } from "@/lib/types";
import type { Extension } from "@codemirror/state";

interface StepScriptProps {
  creationMode: CreationMode;
  script: string;
  onScriptChange: (script: string) => void;
  connectors: Connector[];
  providers: ProviderInfo[];
  onNext: () => void;
  onBack: () => void;
  savingDraft: boolean;
  onSaveDraft: () => void;
  onAssistantComplete: (script: string) => void;
}

export function StepScript({
  creationMode,
  script,
  onScriptChange,
  connectors,
  providers,
  onNext,
  onBack,
  savingDraft,
  onSaveDraft,
  onAssistantComplete,
}: StepScriptProps) {
  const fileCacheRef = useRef(new Map<string, FileEntry[]>());
  const completionCacheRef = useRef<{
    source: string;
    receiver: string;
    items: FossilCompletionItem[];
  } | null>(null);

  const fossilExtensions = useMemo((): Extension[] => [
    fossilLanguage(),
    fossilAutocomplete(connectors, providers, fileCacheRef, completionCacheRef),
    fossilLinterExtension(),
  ], [connectors, providers]);

  if (creationMode === "assistant") {
    return (
      <AssistantWizard
        onComplete={onAssistantComplete}
        connectors={connectors}
        providers={providers}
      />
    );
  }

  return (
    <PageShell>
      <PageShell.Content className="gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 ml-auto">
            {connectors.length > 0 && (
              <span className="text-xs text-muted-foreground">
                Type{" "}
                <kbd className="rounded border px-1 py-0.5 text-[10px] font-mono">
                  @
                </kbd>{" "}
                to reference connections
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onSaveDraft}
                  disabled={!script.trim() || savingDraft}
                  aria-label="Save draft"
                >
                  {savingDraft ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save draft</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <CodeEditor
          value={script}
          onChange={onScriptChange}
          extensions={fossilExtensions}
          placeholder="Write your Fossil script here..."
          className="flex-1"
        />
      </PageShell.Content>

      <PageShell.Footer>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back
        </Button>
        <Button onClick={onNext} disabled={!script.trim()}>
          Next
          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
