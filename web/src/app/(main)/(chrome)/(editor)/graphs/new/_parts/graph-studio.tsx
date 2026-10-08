"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import {
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  Field,
  FieldLabel,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Show,
  Spinner,
  Toggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@kanzo-tech/ui";
import { Check, ChevronDown, FolderTree, Save } from "lucide-react";
import { useRouter } from "@kanzo-tech/navigation/next";
import { $api, http, invalidate, type Schemas } from "@/lib/api/client";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { storageConnections } from "@/lib/connections";
import { type FieldProblem, fieldProblem, toastError } from "@/lib/errors";
import { refs as referencesOf } from "@fossil-lang/wasm";
import * as checker from "@/lib/fossil/checker";
import { AssistantWizard } from "./assistant-wizard";
import { ModePicker } from "./mode-picker";
import { folderProblem, folderSlug } from "./folder";
import { FindingsBadge } from "./findings-badge";
import { nameProblem } from "./graph-name";
import { StudioSources } from "./studio-sources";
import { type EditorApi, StudioEditor } from "./studio-editor";
import { StudioOutput, type OutputValues } from "./studio-output";
import { UnsavedChangesGuard } from "@/lib/ui/unsaved-changes-guard";
import { useGraphEditorStore } from "./graph-editor-store";
import { lower, WORDS } from "@/lib/vocabulary";

/** Quiet before the draft writes itself. Long enough that a pause in typing is
 *  a pause, short enough that leaving the tab does not lose a paragraph. */
const AUTOSAVE_MS = 1500;

/**
 * The graph studio: one screen, the program and its sources beside it.
 *
 * What the program reads and where its output lands are not pages to walk
 * through but properties of the program you are writing: the files it can read
 * are an explorer beside it (a catalog explorer's tree), and where it lands sits
 * beside its name, the way a document shows its folder. What the compiler found
 * is the header's tally, pressed to list it. Create is the one commit point and commits: when something stands in
 * its way it says what, and pressing it shows where. The draft saves itself, so
 * the strip at the bottom reports rather than commands.
 */
export function GraphStudioPage() {
  const id = useSearchParams().get("draft");
  return (
    <Boundary
      fallback={
        <Loading>
          <Spinner className="m-auto" />
        </Loading>
      }
    >
      {id ? <StoredDraft id={id} /> : <GraphStudio />}
    </Boundary>
  );
}

/** A `?draft=` that does not exist is not found, and nothing autosaves into it. */
function StoredDraft({ id }: { id: string }) {
  const draft = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}", { params: { path: { id } } }));
  return <GraphStudio draft={draft.status === "draft" ? draft : undefined} />;
}

function GraphStudio({ draft }: { draft?: Schemas["Graph"] }) {
  const router = useRouter();

  const store = useGraphEditorStore();
  const [railOpen, setRailOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [editor, setEditor] = useState<EditorApi | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly checker.CheckRow[]>([]);
  const [refs, setRefs] = useState<checker.SourceRefInfo[]>([]);
  const [refsProblem, setRefsProblem] = useState<unknown>(undefined);
  const [saved, setSaved] = useState(true);

  // The draft's server id: the `?draft=` the editor arrived with, or the one the
  // first autosave minted, so later saves UPDATE it and Create submits it. A ref
  // beside the state, because a save chained behind another reads it after the
  // render that closed over it.
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const draftIdRef = useRef(draftId);
  // The save in flight, which Create awaits to learn the draft's id; the armed
  // autosave, which Create disarms; and whether Create has begun, after which
  // nothing autosaves.
  const savingRef = useRef<Promise<string> | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submittingRef = useRef(false);
  // What the server refused on Create, keyed to the value it was about, so
  // editing that value clears it.
  const [refused, setRefused] = useState<(FieldProblem & { value: string }) | null>(null);

  const allConnections = settled($api.useSuspenseQuery("get", "/v1/connections"));
  const connections = useMemo(() => storageConnections(allConnections), [allConnections]);
  const providers = settled(useSuspenseQuery(checker.providersQuery));

  useEffect(() => {
    if (!draft) return;
    store.restoreDraft(draft.script ?? "", draft.name ?? "", draft.sink_connection, draft.folder ?? null);
    setSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => () => useGraphEditorStore.getState().reset(), []);

  // ── The program's lineage ───────────────────────────────────────────────
  // A graph's connections are its program's `@conn` references, read out of
  // fossil's typed lineage — the same parse `fossil refs` runs natively, so the
  // browser and the CLI never disagree about what a graph reads. One computation
  // feeds the status strip's count.
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      void referencesOf(store.script)
        .then((rows) => {
          if (!alive) return;
          setRefs(rows);
          setRefsProblem(undefined);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setRefs([]);
          setRefsProblem(err);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [store.script]);

  // Every graph lands in a sink. With one in the workspace there is nothing to
  // choose, so it is chosen.
  const sinks = useMemo(() => connections.filter((c) => c.direction === "sink"), [connections]);
  const sources = useMemo(() => connections.filter((c) => c.direction !== "sink"), [connections]);
  useEffect(() => {
    if (sinks.length === 1 && !useGraphEditorStore.getState().sinkConnectionId) {
      store.setSinkConnectionId(sinks[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinks]);
  const destination = store.sinkConnectionId;
  const folder = store.folder ?? folderSlug(store.name);
  const folderValid = folderProblem(folder) === null;
  const name = store.name.trim();
  const refusedOn = (field: string, value: string) =>
    refused?.field === field && refused.value === value ? refused.message : null;
  const nameError = nameProblem(store.name) ?? refusedOn("name", name);
  // A folder another graph holds is said by Create's own refusal (409, `data.field` "folder"): there
  // is no asking ahead, which would only race the answer that counts.
  const folderRefused = refusedOn("folder", folder);

  const errors = diagnostics.filter((d) => d.severity === 1).length;
  const showOutput = () => setOutputOpen(true);

  // What stands in Create's way, first thing first: the words its tooltip says,
  // and where pressing it takes the editor to fix it.
  const blocker: { reason: string; show?: () => void } | null = !store.script.trim()
    ? { reason: "Write the program first." }
    : errors > 0
      ? {
          reason: `Fix the program's ${errors === 1 ? "error" : `${errors} errors`} first.`,
          show: () => setFindingsOpen(true),
        }
      : nameError
        ? { reason: `Fix the ${lower(WORDS.graph)}'s name: ${nameError}`, show: () => nameRef.current?.focus() }
        : !destination
          ? { reason: "Pick where the graph lands, beside its name.", show: showOutput }
          : !folderValid
            ? { reason: "Fix the output folder, beside the name.", show: showOutput }
            : folderRefused
              ? { reason: `Fix the output folder, beside the name: ${folderRefused}`, show: showOutput }
              : null;

  // ── Saving ──────────────────────────────────────────────────────────────

  // Reads the store when it runs, not when it was armed: a save waits its turn
  // behind the one in flight, and sends what is there by then.
  const writeDraft = async (): Promise<string> => {
    const s = useGraphEditorStore.getState();
    const id = draftIdRef.current;
    if (submittingRef.current && id) return id;
    const name = s.name.trim() && !nameProblem(s.name) ? s.name.trim() : undefined;
    const folder = s.folder ?? folderSlug(s.name);
    const body = { script: s.script, name, folder: folderProblem(folder) ? undefined : folder };
    if (id) {
      await http.PATCH("/v1/graphs/{id}", { params: { path: { id } }, body });
      return id;
    }
    if (!s.sinkConnectionId) throw new Error("Pick a destination before saving");
    const { data: created } = await http.POST("/v1/graphs", {
      body: { ...body, sink_connection: s.sinkConnectionId },
    });
    return created!.id;
  };

  const draftMutation = useMutation({
    mutationFn: () => {
      // The id lands in the chain itself: Create awaits this promise, and `onSuccess` runs later.
      const run = (savingRef.current ?? Promise.resolve())
        .catch(() => undefined) // the last save toasted its own failure
        .then(writeDraft)
        .then((id) => (draftIdRef.current = id));
      savingRef.current = run;
      return run;
    },
    onSuccess: async (id) => {
      setDraftId(id);
      setSaved(true);
      await invalidate("/v1/graphs");
    },
    onError: (err) => toastError(err, "Failed to save draft"),
  });

  const save = draftMutation.mutate;
  const savable = !!store.script.trim() && (!!draftId || !!destination);

  // The dependency is the CONTENT, not the callback: on a stable `[save]` this
  // would run once at mount and never again, and the strip would say "draft
  // saved" from the first second through every edit after it.
  useEffect(() => {
    if (!savable || submittingRef.current) return;
    setSaved(false);
    autosaveRef.current = setTimeout(() => {
      if (!submittingRef.current) save();
    }, AUTOSAVE_MS);
    return () => clearTimeout(autosaveRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.script, store.name, store.folder]);

  // The draft becomes the graph, in place and under its id (Linear's draft
  // becoming the issue): a refusal leaves it a draft, as it was.
  const confirmMutation = useMutation({
    mutationFn: async (sent: { name: string; folder: string }) => {
      submittingRef.current = true;
      clearTimeout(autosaveRef.current);
      await savingRef.current?.catch(() => undefined); // a failed save toasted itself; Create sends the script anyway
      // A graph begins as a draft, always; submitting it is what makes it run. The script crosses
      // once: in the draft written now, or in the submit when the last save did not carry it.
      const existing = draftIdRef.current;
      const id = existing ?? (draftIdRef.current = await writeDraft());
      setDraftId(id);
      const script = existing && !saved ? store.script : undefined;
      const body = { script, name: sent.name || undefined, folder: sent.folder };
      const { data: graph } = await http.POST("/v1/graphs/{id}/submit", { params: { path: { id } }, body });
      return graph!;
    },
    onSuccess: async (graph) => {
      await invalidate("/v1/graphs");
      router.push(`/graphs/${graph.id}`);
    },
    onError: (err, sent) => {
      submittingRef.current = false;
      const problem = fieldProblem(err);
      if (problem?.field === "folder") {
        setRefused({ ...problem, value: sent.folder });
        showOutput();
      } else if (problem?.field === "name") {
        setRefused({ ...problem, value: sent.name });
        nameRef.current?.focus();
      } else {
        toastError(err, `Could not create the ${lower(WORDS.graph)}`);
      }
      // The edits Create carried were not kept; the draft takes them now.
      if (savable) save();
    },
  });

  const submitting = confirmMutation.isPending || confirmMutation.isSuccess;
  const dirty = !saved && !submitting;

  const output: OutputValues = {
    sinkConnectionId: store.sinkConnectionId,
    folder,
  };
  const onOutputChange = useCallback((patch: Partial<OutputValues>) => {
    const s = useGraphEditorStore.getState();
    if (patch.sinkConnectionId !== undefined) s.setSinkConnectionId(patch.sinkConnectionId);
    if (patch.folder !== undefined) s.setFolder(patch.folder);
  }, []);

  // ── Before the studio opens ─────────────────────────────────────────────

  if (store.creationMode === null) {
    return <ModePicker onBack={() => router.push("/graphs")} onSelect={store.setCreationMode} />;
  }

  if (store.creationMode === "assistant") {
    return (
      <AssistantWizard
        connections={connections}
        onBack={() => store.setCreationMode(null)}
        onComplete={store.completeAssistant}
        providers={providers}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="@container flex h-14 min-w-0 shrink-0 items-center gap-2 border-b px-3">
        <Field className="w-auto" invalid={!!nameError} orientation="horizontal">
          <FieldLabel className="flex-none">Name</FieldLabel>
          <Input
            className="w-64"
            onChange={(e) => store.setName(e.target.value)}
            placeholder={`Unnamed ${lower(WORDS.graph)}`}
            ref={nameRef}
            size="sm"
            value={store.name}
          />
        </Field>
        <StudioOutput
          connections={connections}
          folderRefused={folderRefused}
          onChange={onOutputChange}
          onOpenChange={setOutputOpen}
          open={outputOpen}
          values={output}
        />

        <div className="ms-auto flex items-center gap-1.5">
          <FindingsBadge
            findings={diagnostics}
            onOpenChange={setFindingsOpen}
            onSelect={(f) => editor?.reveal(f.range.start.line, f.range.start.character)}
            open={findingsOpen}
          />
          <ButtonGroup aria-label="Save">
            <Button
              disabled={!savable || draftMutation.isPending || submitting}
              onClick={() => save()}
              size="sm"
              variant="outline"
            >
              <Show fallback={<Save />} when={draftMutation.isPending}>
                <Spinner />
              </Show>
              <span>Save draft</span>
            </Button>
            <ButtonGroupSeparator />
            <Menu>
              <MenuTrigger asChild>
                <Button aria-label={`More ${lower(WORDS.graph)} actions`} size="sm" variant="outline">
                  <ChevronDown />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem
                  onSelect={() => router.push(draftId && draft ? `/graphs/${draftId}` : "/graphs")}
                  value="back"
                >
                  {draft ? `Back to the ${lower(WORDS.graph)}` : `Back to ${lower(WORDS.graphs)}`}
                </MenuItem>
                <MenuItem
                  onSelect={() => {
                    store.setScript("");
                    toast.create({ title: "Program cleared" });
                  }}
                  value="clear"
                >
                  Clear the program
                </MenuItem>
              </MenuContent>
            </Menu>
          </ButtonGroup>
          {/* A disabled button takes no pointer, so the press lands on the wrapper, which shows
              where the blocker is fixed. */}
          <Tooltip disabled={!blocker || submitting}>
            <TooltipTrigger asChild>
              <span
                className="inline-flex"
                onClick={() => blocker?.show?.()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") blocker?.show?.();
                }}
                role="presentation"
                tabIndex={blocker ? 0 : undefined}
              >
                <Button
                  disabled={!!blocker || submitting}
                  onClick={() => confirmMutation.mutate({ name, folder })}
                  size="sm"
                >
                  <Show fallback={<Check />} when={submitting}>
                    <Spinner />
                  </Show>
                  Create
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{blocker?.reason}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <StudioEditor
        onDiagnostics={setDiagnostics}
        onEditor={setEditor}
        onProgramChange={store.setScript}
        program={store.script}
        rail={
          railOpen
            ? {
                label: "Sources",
                onClose: () => setRailOpen(false),
                content: (
                  <StudioSources
                    connections={sources}
                    onInsert={(text) => editor?.insert(text)}
                    problem={refsProblem}
                    providers={providers}
                  />
                ),
              }
            : null
        }
      />

      <div className="flex h-8 shrink-0 flex-row items-center gap-2 border-t px-3 text-muted-foreground text-xs">
        <span className="truncate">
          {refs.length} reference{refs.length === 1 ? "" : "s"}
          {" · "}
          {draftMutation.isPending ? "saving…" : saved ? "draft saved" : "unsaved changes"}
        </span>
        <Toggle className="ms-auto" onPressedChange={setRailOpen} pressed={railOpen} size="sm">
          <FolderTree />
          Sources
        </Toggle>
      </div>

      <UnsavedChangesGuard dirty={dirty} />
    </div>
  );
}
