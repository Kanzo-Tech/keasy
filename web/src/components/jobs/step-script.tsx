"use client";

import { useRef, useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import type { Connection, ProviderInfo, FileEntry, FossilCompletionItem, CreationMode } from "@/lib/types";
import type { Extension } from "@codemirror/state";

interface StepScriptProps {
  creationMode: CreationMode;
  script: string;
  onScriptChange: (script: string) => void;
  shex: string;
  onShexChange: (shex: string) => void;
  connections: Connection[];
  providers: ProviderInfo[];
  onNext: () => void;
  onBack: () => void;
  savingDraft: boolean;
  onSaveDraft: () => void;
  onAssistantComplete: (script: string, shex: string) => void;
}

export function StepScript({
  creationMode,
  script,
  onScriptChange,
  shex,
  onShexChange,
  connections,
  providers,
  onNext,
  onBack,
  savingDraft,
  onSaveDraft,
  onAssistantComplete,
}: StepScriptProps) {
  const [editorTab, setEditorTab] = useState<string>("script");
  const fileCacheRef = useRef(new Map<string, FileEntry[]>());
  const completionCacheRef = useRef<{
    source: string;
    receiver: string;
    items: FossilCompletionItem[];
  } | null>(null);

  const fossilExtensions = useMemo((): Extension[] => [
    fossilLanguage(),
    fossilAutocomplete(connections, providers, fileCacheRef, completionCacheRef),
    fossilLinterExtension(),
  ], [connections, providers]);

  if (creationMode === "assistant") {
    return (
      <AssistantWizard
        onComplete={onAssistantComplete}
        connections={connections}
        providers={providers}
      />
    );
  }

  return (
    <PageShell>
      <PageShell.Content className="gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={editorTab}
            onValueChange={(v) => { if (v) setEditorTab(v); }}
          >
            <ToggleGroupItem value="script">Script</ToggleGroupItem>
            <ToggleGroupItem value="shapes">Shapes</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2 ml-auto">
            {editorTab === "script" && connections.length > 0 && (
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

        {editorTab === "script" ? (
          <CodeEditor
            value={script}
            onChange={onScriptChange}
            extensions={fossilExtensions}
            placeholder="Write your Fossil script here..."
            className="flex-1"
          />
        ) : (
          <CodeEditor
            value={shex}
            onChange={onShexChange}
            placeholder="Write ShEx shapes here..."
            className="flex-1"
          />
        )}
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
