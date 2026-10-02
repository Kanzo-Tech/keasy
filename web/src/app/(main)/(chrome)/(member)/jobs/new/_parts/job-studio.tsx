"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import {
  Badge,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@kanzo-tech/ui";
import { Check, ChevronDown, PanelRight, Pencil, Save, X } from "lucide-react";
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
import { CreateJobDialog } from "./create-job-dialog";
import { FindingsList } from "./findings-list";
import { StudioConnections } from "./studio-connections";
import { StudioEditor } from "./studio-editor";
import { StudioOutput, type OutputValues } from "./studio-output";
import { UnsavedChangesGuard } from "@/lib/ui/unsaved-changes-guard";
import { useJobEditorStore } from "./job-editor-store";

type InspectorTab = "connections" | "output" | "problems";

/** Quiet before the draft writes itself. Long enough that a pause in typing is
 *  a pause, short enough that leaving the tab does not lose a paragraph. */
const AUTOSAVE_MS = 1500;

/**
 * The job studio: one screen, the program and an inspector beside it.
 *
 * Where the output lands and what the compiler found are not pages to walk
 * through but properties of the program you are writing, so they sit in the
 * inspector next to it (Hex, Observable). Create is the one commit point and
 * opens a review of what the job reads and writes, the way a commit dialog does.
 * The draft saves itself, so the strip at the bottom reports rather than commands.
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
  const [tab, setTab] = useState<InspectorTab>("connections");
  const [reviewing, setReviewing] = useState(false);
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
  // feeds the rail's "in use" marks, the status strip's count and Summary's list.
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
  const blocked =
    errors > 0 || !store.script.trim() || !destination || !folderValid || folder === takenFolder;

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
      if (err instanceof ApiError && err.code === "resource/already-exists") setTakenFolder(folder);
      toastError(err, "Failed to create job");
    },
  });

  const submitting = confirmMutation.isPending || confirmMutation.isSuccess;
  const dirty = !saved && !submitting;

  const output: OutputValues = {
    sinkConnectionId: store.sinkConnectionId,
    folder,
  };
  const outputIncomplete = !destination || !folderValid || folder === takenFolder;
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
        <Editable
          activationMode="dblclick"
          className="w-auto max-w-[10rem] @3xl:max-w-[20rem]"
          onValueChange={(d) => store.setName(d.value)}
          placeholder="Unnamed job"
          value={store.name}
        >
          <EditableArea className="w-auto">
            <EditableInput asChild>
              <Input className="h-8 w-56" />
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
          <ValidationBadge
            diagnostics={diagnostics}
            onOpen={() => {
              setRailOpen(true);
              setTab("problems");
            }}
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
          <Button
            disabled={submitting || !store.script.trim()}
            onClick={() => {
              // An incomplete output is fixed where it is set, not in the review.
              if (outputIncomplete) {
                setRailOpen(true);
                setTab("output");
                return;
              }
              setReviewing(true);
            }}
            size="sm"
          >
            <Check />
            Create
          </Button>
        </div>
      </div>

      <StudioEditor
        inspector={(editor) => (
          <Tabs
            className="flex min-h-0 flex-1 flex-col gap-0"
            onValueChange={(d) => setTab(d.value as InspectorTab)}
            value={tab}
          >
            <TabsList className="mx-3 mt-2 w-auto">
              <TabsTrigger value="connections">Connections</TabsTrigger>
              <TabsTrigger value="output">
                Output
                <Show when={outputIncomplete}>
                  <span aria-label="incomplete" className="size-1.5 rounded-full bg-destructive" />
                </Show>
              </TabsTrigger>
              <TabsTrigger value="problems">
                Problems
                <Show when={diagnostics.length > 0}>
                  <Badge size="xs" variant={errors ? "destructive" : "warning"}>
                    {diagnostics.length}
                  </Badge>
                </Show>
              </TabsTrigger>
            </TabsList>
            <TabsContent className="min-h-0 flex-1 overflow-auto" value="connections">
              <StudioConnections
                connections={connections}
                onInsert={editor.insert}
                used={usedNames}
              />
            </TabsContent>
            <TabsContent className="min-h-0 flex-1 overflow-auto" value="output">
              <StudioOutput
                connections={connections}
                folderTaken={folder === takenFolder}
                onChange={onOutputChange}
                values={output}
              />
            </TabsContent>
            <TabsContent className="min-h-0 flex-1 overflow-auto p-3" value="problems">
              <Show
                fallback={
                  <p className="text-muted-foreground text-sm">
                    Every reference resolves and every mapping type-checks.
                  </p>
                }
                when={diagnostics.length > 0}
              >
                <FindingsList
                  findings={diagnostics}
                  onSelect={(f) => editor.reveal(f.range.start.line, f.range.start.character)}
                />
              </Show>
            </TabsContent>
          </Tabs>
        )}
        onDiagnostics={setDiagnostics}
        onProgramChange={store.setScript}
        program={store.script}
        railOpen={railOpen}
      />

      <div className="flex h-8 shrink-0 flex-row items-center gap-2 border-t px-3 text-muted-foreground text-xs">
        <span className="truncate">
          {refs.length} reference{refs.length === 1 ? "" : "s"}
          {" · "}
          {draftMutation.isPending ? "saving…" : saved ? "draft saved" : "unsaved changes"}
        </span>
        <ToggleGroup
          aria-label="Panels"
          className="ms-auto"
          multiple={false}
          onValueChange={(d) => setRailOpen(d.value.length > 0)}
          size="sm"
          spacing={2}
          value={railOpen ? ["inspector"] : []}
        >
          <ToggleGroupItem aria-label="Inspector" value="inspector">
            <PanelRight />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <CreateJobDialog
        blocked={blocked}
        connections={connections}
        creating={submitting}
        findings={diagnostics}
        name={store.name}
        onCreate={() => {
          if (!draftMutation.isPending) confirmMutation.mutate();
        }}
        onOpenChange={setReviewing}
        open={reviewing}
        output={output}
        refs={refs}
        refsProblem={refsProblem}
      />
      <UnsavedChangesGuard dirty={dirty} />
    </div>
  );
}

/** The compiler's tally; it opens the Problems tab, where each finding jumps to its line. */
function ValidationBadge({
  diagnostics,
  onOpen,
}: {
  diagnostics: readonly checker.CheckRow[];
  onOpen: () => void;
}) {
  const errors = diagnostics.filter((d) => d.severity === 1).length;
  const warnings = diagnostics.length - errors;
  return (
    <Badge asChild size="lg" variant={errors ? "destructive" : warnings ? "warning" : "success"}>
      <button onClick={onOpen} type="button">
        {errors
          ? `${errors} error${errors === 1 ? "" : "s"}`
          : warnings
            ? `${warnings} warning${warnings === 1 ? "" : "s"}`
            : "Valid"}
      </button>
    </Badge>
  );
}
