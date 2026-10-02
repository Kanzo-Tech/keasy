"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import {
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  Editable,
  EditableArea,
  EditableCancelTrigger,
  EditableControl,
  EditableEditTrigger,
  EditableInput,
  EditablePreview,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Show,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@kanzo-tech/ui";
import { Check, ChevronDown, FolderOutput, Pencil, PlugZap, Save, X } from "lucide-react";
import { useRouter } from "@kanzo-tech/navigation/next";
import { $api, ApiError, http, invalidate, type Schemas } from "@/lib/api/client";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { storageConnections } from "@/lib/connections";
import { type Shown, toastError, toProblem } from "@/lib/errors";
import * as checker from "@/lib/fossil/checker";
import { AssistantWizard } from "./assistant-wizard";
import { ModePicker } from "./mode-picker";
import { folderProblem, folderSlug } from "./folder";
import { FindingsBadge } from "./findings-badge";
import { StudioConnections } from "./studio-connections";
import { type EditorApi, StudioEditor } from "./studio-editor";
import { StudioOutput, type OutputValues } from "./studio-output";
import { UnsavedChangesGuard } from "@/lib/ui/unsaved-changes-guard";
import { useJobEditorStore } from "./job-editor-store";

const PANELS = [
  { id: "connections", label: "Connections", icon: PlugZap },
  { id: "output", label: "Output", icon: FolderOutput },
] as const;

type PanelId = (typeof PANELS)[number]["id"];

/** Quiet before the draft writes itself. Long enough that a pause in typing is
 *  a pause, short enough that leaving the tab does not lose a paragraph. */
const AUTOSAVE_MS = 1500;

/**
 * The job studio: one screen, the program and one panel beside it.
 *
 * What the program reads and where its output lands are not pages to walk
 * through but properties of the program you are writing, so they are panels
 * next to it, picked from the bottom strip the way discovery picks its dock
 * (Hex, Observable). What the compiler found is the header's tally, pressed to
 * list it. Create is the one commit point and commits: when something stands in
 * its way it says what, and pressing it shows where. The draft saves itself, so
 * the strip at the bottom reports rather than commands.
 */
export function JobStudioPage() {
  const id = useSearchParams().get("draft");
  return (
    <Boundary
      fallback={
        <Loading>
          <Spinner className="m-auto" />
        </Loading>
      }
    >
      {id ? <StoredDraft id={id} /> : <JobStudio />}
    </Boundary>
  );
}

/** A `?draft=` that does not exist is not found, and nothing autosaves into it. */
function StoredDraft({ id }: { id: string }) {
  const draft = settled($api.useSuspenseQuery("get", "/v1/jobs/{id}", { params: { path: { id } } }));
  return <JobStudio draft={draft.status === "draft" ? draft : undefined} />;
}

function JobStudio({ draft }: { draft?: Schemas["Job"] }) {
  const router = useRouter();

  const store = useJobEditorStore();
  const [railOpen, setRailOpen] = useState(true);
  const [panel, setPanel] = useState<PanelId>("connections");
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [editor, setEditor] = useState<EditorApi | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly checker.CheckRow[]>([]);
  const [refs, setRefs] = useState<checker.SourceRefInfo[]>([]);
  const [refsProblem, setRefsProblem] = useState<Shown | null>(null);
  const [saved, setSaved] = useState(true);

  // The draft's server id: the `?draft=` the member arrived with, or the one the
  // first autosave minted. Held in state so subsequent saves UPDATE rather than
  // creating a second draft per keystroke pause.
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);

  const allConnections = settled($api.useSuspenseQuery("get", "/v1/connections"));
  const connections = useMemo(() => storageConnections(allConnections), [allConnections]);
  const providers = settled(useSuspenseQuery(checker.providersQuery));

  useEffect(() => {
    if (!draft) return;
    store.restoreDraft(draft.script ?? "", draft.name ?? "", draft.sink_connection, draft.folder ?? null);
    setSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => () => useJobEditorStore.getState().reset(), []);

  // ── The program's lineage ───────────────────────────────────────────────
  // A job's connections are its program's `@conn` references, read out of
  // fossil's typed lineage — the same parse `fossil refs` runs natively, so the
  // browser and the CLI never disagree about what a job reads. One computation
  // feeds the Connections panel's "in use" marks and the status strip's count.
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      void checker
        .refs(store.script)
        .then((rows) => {
          if (!alive) return;
          setRefs(rows);
          setRefsProblem(null);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setRefs([]);
          setRefsProblem(toProblem(err));
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [store.script]);

  const usedNames = useMemo(
    () => new Set(refs.map((r) => r.connection).filter((c): c is string => !!c)),
    [refs],
  );

  // Every job lands in a sink. With one in the workspace there is nothing to
  // choose, so it is chosen.
  const sinks = useMemo(() => connections.filter((c) => c.direction === "sink"), [connections]);
  useEffect(() => {
    if (sinks.length === 1 && !useJobEditorStore.getState().sinkConnectionId) {
      store.setSinkConnectionId(sinks[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinks]);
  const destination = store.sinkConnectionId;
  const folder = store.folder ?? folderSlug(store.name);
  const folderValid = folderProblem(folder) === null;
  // The folder the server last said another job holds, so the field can say so
  // until the member picks another.
  const [takenFolder, setTakenFolder] = useState<string | null>(null);

  const errors = diagnostics.filter((d) => d.severity === 1).length;
  const outputIncomplete = !destination || !folderValid || folder === takenFolder;

  const openPanel = (id: PanelId) => {
    setPanel(id);
    setRailOpen(true);
  };

  // What stands in Create's way, first thing first: the words its tooltip says,
  // and where pressing it takes the member to fix it.
  const blocker: { reason: string; show?: () => void } | null = !store.script.trim()
    ? { reason: "Write the program first." }
    : errors > 0
      ? {
          reason: `Fix the program's ${errors === 1 ? "error" : `${errors} errors`} first.`,
          show: () => setFindingsOpen(true),
        }
      : !destination
        ? { reason: "Pick where the graph lands, under Output.", show: () => openPanel("output") }
        : folder === takenFolder
          ? {
              reason: "Another job writes to this folder. Pick another under Output.",
              show: () => openPanel("output"),
            }
          : !folderValid
            ? { reason: "Fix the output folder, under Output.", show: () => openPanel("output") }
            : null;

  // ── Saving ──────────────────────────────────────────────────────────────

  const draftMutation = useMutation({
    mutationFn: async () => {
      const name = store.name.trim() || undefined;
      if (draftId) {
        await http.PUT("/v1/jobs/{id}", {
          params: { path: { id: draftId } },
          body: {
            script: store.script,
            name,
            folder: folderValid ? folder : undefined,
          },
        });
        return draftId;
      }
      if (!destination) throw new Error("Pick a destination before saving");
      const { data: created } = await http.POST("/v1/jobs", {
        body: {
          script: store.script,
          name,
          draft: true,
          sink_connection: destination,
          folder: folderValid ? folder : undefined,
        },
      });
      return created!.id;
    },
    onSuccess: async (id) => {
      setDraftId(id);
      setSaved(true);
      await invalidate("/v1/jobs");
    },
    onError: (err) => toastError(err, "Failed to save draft"),
  });

  const save = draftMutation.mutate;
  const savable = !!store.script.trim() && (!!draftId || !!destination);

  // The dependency is the CONTENT, not the callback: on a stable `[save]` this
  // would run once at mount and never again, and the strip would say "draft
  // saved" from the first second through every edit after it.
  useEffect(() => {
    if (!savable || draftMutation.isPending) return;
    setSaved(false);
    const id = setTimeout(() => save(), AUTOSAVE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.script, store.name, store.folder]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      // The draft becomes the job: keasy has no promote endpoint, so the draft
      // is dropped and the real job created in its place.
      if (!destination) throw new Error("Pick a destination before launching");
      if (draftId) {
        // The job is launched either way; a draft left behind is said, not swallowed.
        await http
          .DELETE("/v1/jobs/{id}", { params: { path: { id: draftId } } })
          .catch((err: unknown) => toastError(err, "The draft could not be removed"));
      }
      const { data: job } = await http.POST("/v1/jobs", {
        body: {
          script: store.script,
          name: store.name.trim() || undefined,
          sink_connection: destination,
          folder,
        },
      });
      return job!;
    },
    onSuccess: async (job) => {
      await invalidate("/v1/jobs");
      router.push(`/jobs/${job.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "resource/already-exists") {
        setTakenFolder(folder);
        openPanel("output");
      }
      toastError(err, "Failed to create job");
    },
  });

  const submitting = confirmMutation.isPending || confirmMutation.isSuccess;
  const dirty = !saved && !submitting;

  const output: OutputValues = {
    sinkConnectionId: store.sinkConnectionId,
    folder,
  };
  const onOutputChange = useCallback((patch: Partial<OutputValues>) => {
    const s = useJobEditorStore.getState();
    if (patch.sinkConnectionId !== undefined) s.setSinkConnectionId(patch.sinkConnectionId);
    if (patch.folder !== undefined) s.setFolder(patch.folder);
  }, []);

  // ── Before the studio opens ─────────────────────────────────────────────

  if (store.creationMode === null) {
    return <ModePicker onSelect={store.setCreationMode} />;
  }

  if (store.creationMode === "assistant") {
    return (
      <AssistantWizard
        connections={connections}
        onComplete={store.completeAssistant}
        providers={providers}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="@container flex h-14 min-w-0 shrink-0 items-center gap-2 border-b px-3">
        {/* At rest the preview sizes the root and truncates itself; editing, the root takes a
            fixed width that the input fills, so the cancel button closes the field at its end. */}
        <Editable
          activationMode="dblclick"
          className="w-auto max-w-[10rem] has-[[data-slot=editable-area][data-focus]]:w-64 has-[[data-slot=editable-area][data-focus]]:max-w-[50cqw] @3xl:max-w-[20rem]"
          onValueChange={(d) => store.setName(d.value)}
          placeholder="Unnamed job"
          value={store.name}
        >
          <EditableArea className="w-auto data-focus:flex-1">
            <EditableInput asChild>
              <Input size="sm" />
            </EditableInput>
            <EditablePreview className="font-medium" size="sm" variant="ghost" />
          </EditableArea>
          <EditableControl>
            <EditableEditTrigger asChild>
              <Button aria-label="Rename job" size="icon-sm" variant="ghost">
                <Pencil />
              </Button>
            </EditableEditTrigger>
            <EditableCancelTrigger asChild>
              <Button aria-label="Discard the new name" size="icon-sm" variant="ghost">
                <X />
              </Button>
            </EditableCancelTrigger>
          </EditableControl>
        </Editable>

        <div className="ms-auto flex items-center gap-1.5">
          <FindingsBadge
            findings={diagnostics}
            onOpenChange={setFindingsOpen}
            onSelect={(f) => {
              setFindingsOpen(false);
              editor?.reveal(f.range.start.line, f.range.start.character);
            }}
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
              <span className="hidden @5xl:inline">Save draft</span>
            </Button>
            <ButtonGroupSeparator />
            <Menu>
              <MenuTrigger asChild>
                <Button aria-label="More job actions" size="sm" variant="outline">
                  <ChevronDown />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => router.push("/jobs")} value="jobs">
                  Back to jobs
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
                  onClick={() => {
                    // A create racing the autosave's first POST would leave its draft behind.
                    if (!draftMutation.isPending) confirmMutation.mutate();
                  }}
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
                label: PANELS.find((p) => p.id === panel)!.label,
                onClose: () => setRailOpen(false),
                content:
                  panel === "connections" ? (
                    <StudioConnections
                      connections={connections}
                      onInsert={(text) => editor?.insert(text)}
                      used={usedNames}
                      usedProblem={refsProblem}
                    />
                  ) : (
                    <StudioOutput
                      connections={connections}
                      folderTaken={folder === takenFolder}
                      onChange={onOutputChange}
                      values={output}
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
        {/* Single-select and deselectable: pressing the open panel's icon again collapses the rail. */}
        <ToggleGroup
          aria-label="Panels"
          className="ms-auto"
          multiple={false}
          onValueChange={(d) => {
            const next = d.value[0] as PanelId | undefined;
            if (next) openPanel(next);
            else setRailOpen(false);
          }}
          size="sm"
          spacing={2}
          value={railOpen ? [panel] : []}
        >
          {PANELS.map((p) => (
            <ToggleGroupItem aria-label={p.label} className="relative" key={p.id} title={p.label} value={p.id}>
              <p.icon />
              <Show when={p.id === "output" && outputIncomplete}>
                <span
                  aria-label="incomplete"
                  className="absolute end-1 top-1 size-1.5 rounded-full bg-destructive"
                />
              </Show>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <UnsavedChangesGuard dirty={dirty} />
    </div>
  );
}
