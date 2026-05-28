"use client";

import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/layout/page-shell";
import { FossilEditor, HttpTransport } from "@fossil-lang/editor";
import type {
  ConnectionResolver,
  Connector,
  ResolvedSource,
  SourceRef,
} from "@fossil-lang/types";
import { AssistantWizard } from "@/components/jobs/assistant-wizard";
import { ArrowLeft, ArrowRight, Save, Loader2 } from "lucide-react";
import type { Connection, ProviderInfo, CreationMode } from "@/lib/types";

// ── Keasy → @fossil-lang/types adapter ─────────────────────────────────
//
// Bridges Keasy's (`Connection[]`, `ProviderInfo[]`) UI state into the
// `ConnectionResolver` contract consumed by <FossilEditor/>'s `@`-prefix
// autocomplete. Narrow surface — only `list()` is wired:
//
//   - `list()`: enumerate `data`-kind connections as `{ name, type, label }`
//     `Connector` rows. `type` is collapsed to `'public_http'` because the
//     Tier-1 connector taxonomy (`local_file | public_http | upload |
//     examples` per ADR-0029) is closed and Keasy's cloud-mediated S3/GCS/
//     Azure connectors don't slot into it cleanly. The editor uses `type`
//     only to pick an icon — `'public_http'` produces the generic cloud
//     glyph which is the correct affordance for Keasy.
//   - `resolve()`: not used at edit time — Keasy script execution happens
//     server-side via `/v1/fossil/lsp` analyze, which already has the org's
//     PathResolver (`db.build_path_resolver_for_org`). We surface a clear
//     runtime error if the editor ever calls it (the @-autocomplete path
//     does not).
//
// Memoised via `useMemo` on the (connections, providers) tuple so the
// editor's mount effect doesn't tear down on every render.
function useKeasyResolver(
  connections: Connection[],
  _providers: ProviderInfo[],
): ConnectionResolver {
  return useMemo<ConnectionResolver>(() => {
    const dataConnections = connections.filter((c) => c.kind === "data");
    return {
      async list(): Promise<Connector[]> {
        return dataConnections.map<Connector>((c) => ({
          name: c.name,
          // Tier-1 enum is closed; 'public_http' is the safe default for
          // host-mediated cloud connectors. The icon in the @-autocomplete
          // popover is the only consumer of this field.
          type: "public_http",
          label: c.name,
        }));
      },
      async resolve(ref: SourceRef): Promise<ResolvedSource> {
        // Keasy resolves at execution time (server-side, per-org). If the
        // editor ever calls this (it shouldn't — completion only uses
        // list()), fail loud rather than returning a stub URL.
        throw new Error(
          `Keasy ConnectionResolver.resolve() not implemented at edit time — ` +
            `script execution resolves @${ref.connector}/ via /v1/fossil/lsp ` +
            `(server-side PathResolver per org).`,
        );
      },
    };
  }, [connections, _providers]);
}

interface StepScriptProps {
  creationMode: CreationMode;
  script: string;
  onScriptChange: (script: string) => void;
  connections: Connection[];
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
  connections,
  providers,
  onNext,
  onBack,
  savingDraft,
  onSaveDraft,
  onAssistantComplete,
}: StepScriptProps) {
  // HTTP transport — POSTs JSON-RPC envelopes to /v1/fossil/lsp on the
  // same origin (cookie session handles auth; no explicit Authorization
  // header needed). Memoised so the editor's mount effect doesn't tear
  // down on every render.
  const lspTransport = useMemo(
    () =>
      new HttpTransport({
        endpoint: "/v1/fossil/lsp",
      }),
    [],
  );

  const resolver = useKeasyResolver(connections, providers);

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
          <div className="flex items-center gap-2 ml-auto">
            {connections.length > 0 && (
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

        {/*
          FossilEditor auto-composes the language extension + LSP wiring
          from `lspTransport` and `resolver`. The previous in-tree CodeEditor
          accepted a `placeholder` prop; FossilEditor does not yet expose
          one (see 16-04 deferred-items.md). The "Type @ to reference
          connections" hint above the editor stands in as the empty-state
          cue.
        */}
        <FossilEditor
          value={script}
          onChange={onScriptChange}
          lspTransport={lspTransport}
          resolver={resolver}
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
