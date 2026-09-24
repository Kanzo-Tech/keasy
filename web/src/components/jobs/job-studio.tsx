"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  ScrollArea,
  Show,
  Spinner,
  Steps,
  StepsContent,
  StepsIndicator,
  StepsItem,
  StepsList,
  StepsSeparator,
  StepsTitle,
  StepsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@kanzo-tech/ui";
import { ChevronDown, Pencil, PlugZap, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { toastError } from "@/lib/toast-error";
import * as checker from "@/lib/fossil/checker";
import { AssistantWizard } from "@/components/jobs/assistant-wizard";
import { ModePicker } from "@/components/jobs/mode-picker";
import { StudioConfigure, type ConfigValues } from "@/components/jobs/studio-configure";
import { StudioEditor } from "@/components/jobs/studio-editor";
import { StudioSummary } from "@/components/jobs/studio-summary";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
import { useJobEditorStore } from "./job-editor-store";

const STEPS = ["Editor", "Configure", "Summary"] as const;

/** Quiet before the draft writes itself. Long enough that a pause in typing is
 *  a pause, short enough that leaving the tab does not lose a paragraph. */
const AUTOSAVE_MS = 1500;

/**
 * The job studio — three pages of one job.
 *
 * `Steps` is honest about them because each one IS a page, and `StepsContent`
 * hides the inactive ones with the `hidden` attribute rather than unmounting
 * them: the editor keeps its undo history, its scroll position and its wasm
 * workspace while you are two pages away. What this replaces returned a
 * different tree per step, so the program — the thing you come back to — was
 * rebuilt every time.
 *
 * The name lives in the header, editable in place, because it labels all three
 * pages rather than being Configure's first field. The draft saves itself, so
 * the strip at the bottom reports rather than commands.
 */
export function JobStudio() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const store = useJobEditorStore();
  const [railOpen, setRailOpen] = useState(true);
  const [diagnostics, setDiagnostics] = useState<readonly checker.CheckRow[]>([]);
  const [refs, setRefs] = useState<checker.SourceRefInfo[]>([]);
  const [saved, setSaved] = useState(true);

  // The draft's server id: the `?draft=` the member arrived with, or the one the
  // first autosave minted. Held in state so subsequent saves UPDATE rather than
  // creating a second draft per keystroke pause.
  const [draftId, setDraftId] = useState<string | null>(searchParams.get("draft"));

  const { data: orgIdentity } = useQuery({
    queryKey: queryKeys.org.identity,
    queryFn: api.org.identity,
  });
  const { data: connections = [] } = useQuery({
    queryKey: queryKeys.connections.all(),
    queryFn: () => api.connections.list(),
  });
  const { data: providers = [] } = useQuery({
    queryKey: queryKeys.settings.providers,
    queryFn: checker.providers,
  });

  const orgConfigured = orgIdentity != null && !!orgIdentity.legal_name;

  useEffect(() => {
    if (orgConfigured) store.setDcatEnabled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgConfigured]);

  const { data: draftJob } = useQuery({
    queryKey: queryKeys.jobs.detail(draftId!),
    queryFn: () => api.jobs.get(draftId!),
    enabled: !!searchParams.get("draft"),
  });

  useEffect(() => {
    if (!draftJob || draftJob.status !== "draft") return;
    store.restoreDraft(
      draftJob.script ?? "",
      draftJob.name ?? "",
      draftJob.mode,
      draftJob.sink_connection_id ?? null,
    );
    setSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJob]);

  useEffect(() => () => useJobEditorStore.getState().reset(), []);

  // ── The program's lineage ───────────────────────────────────────────────
  // A job's connections are its program's `@conn` references, read out of
  // fossil's typed lineage — the same parse `fossil refs` runs natively, so the
  // browser and the CLI never disagree about what a job reads. One computation
  // feeds the rail's "in use" marks, the status strip's count, Summary's list
  // and the `connection_ids` the create request carries.
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      void checker
        .refs(store.script)
        .then((rows) => alive && setRefs(rows))
        .catch(() => alive && setRefs([]));
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
  const connectionIds = useMemo(
    () => connections.filter((c) => usedNames.has(c.name)).map((c) => c.id),
    [connections, usedNames],
  );

  const errors = diagnostics.filter((d) => d.severity === 1).length;
  const blocked = errors > 0 || !store.script.trim();

  // ── Saving ──────────────────────────────────────────────────────────────

  const draftMutation = useMutation({
    mutationFn: async () => {
      const name = store.name.trim() || undefined;
      if (draftId) {
        await api.jobs.update(draftId, { script: store.script, name });
        return draftId;
      }
      const created = await api.jobs.create({
        script: store.script,
        name,
        mode: store.mode,
        draft: true,
        connection_ids: connectionIds.length > 0 ? connectionIds : undefined,
      });
      return created.id;
    },
    onSuccess: async (id) => {
      setDraftId(id);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
    onError: (err) => toastError(err, "Failed to save draft"),
  });

  const save = draftMutation.mutate;
  const savable = !!store.script.trim();

  // The dependency is the CONTENT, not the callback: on a stable `[save]` this
  // would run once at mount and never again, and the strip would say "draft
  // saved" from the first second through every edit after it.
  useEffect(() => {
    if (!savable || draftMutation.isPending) return;
    setSaved(false);
    const id = setTimeout(() => save(), AUTOSAVE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.script, store.name]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      // The draft becomes the job: keasy has no promote endpoint, so the draft
      // is dropped and the real job created in its place.
      if (draftId) await api.jobs.remove(draftId).catch(() => {});
      return api.jobs.create({
        script: store.script,
        name: store.name.trim() || undefined,
        mode: store.mode,
        dcat_enabled: store.dcatEnabled || undefined,
        connection_ids: connectionIds.length > 0 ? connectionIds : undefined,
        sink_connection_id: store.sinkConnectionId ?? undefined,
      });
    },
    onSuccess: async (job) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      router.push(`/jobs/${job.id}`);
    },
    onError: (err) => toastError(err, "Failed to create job"),
  });

  const submitting = confirmMutation.isPending || confirmMutation.isSuccess;

  const config: ConfigValues = {
    mode: store.mode,
    sinkConnectionId: store.sinkConnectionId,
    dcatEnabled: store.dcatEnabled,
  };
  const onConfigChange = useCallback((patch: Partial<ConfigValues>) => {
    const s = useJobEditorStore.getState();
    if (patch.mode !== undefined) s.setMode(patch.mode);
    if (patch.sinkConnectionId !== undefined) s.setSinkConnectionId(patch.sinkConnectionId);
    if (patch.dcatEnabled !== undefined) s.setDcatEnabled(patch.dcatEnabled);
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
    <Steps
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
      count={STEPS.length}
      onStepChange={(d) => store.setStep(Math.min(d.step, STEPS.length - 1))}
      step={store.step}
    >
      <UnsavedChangesGuard isDirty={!saved && !submitting} />

      {/* A three-column grid, so the steps sit on the band's true centre no
          matter how long the job's name is — a flex row with `ms-auto` only
          pushes them off the left group's width, which moves every time the name
          is edited. `@container`, and every threshold below is a CONTAINER
          query: what gets narrow here is the page minus the sidebar, and `md:`
          cannot see the sidebar. */}
      <div className="@container grid h-14 min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          <Editable
            activationMode="dblclick"
            className="w-auto shrink-0"
            onValueChange={(d) => store.setName(d.value)}
            placeholder="Unnamed job"
            value={store.name}
          >
            <EditableArea className="w-auto">
              <EditableInput asChild>
                <Input className="h-8 w-56" />
              </EditableInput>
              {/* `block` is what makes `truncate` work: `EditablePreview` bakes
                  in `whitespace-pre-wrap` and inherits `inline-flex`, and
                  ellipsis does nothing on a flex container. `whitespace-nowrap`
                  is spelled out beside `truncate` because tailwind-merge files
                  them under different groups. */}
              <EditablePreview
                className="block w-auto max-w-[8rem] truncate whitespace-nowrap px-2 py-1 font-medium @3xl:max-w-[16rem]"
                size="sm"
                variant="ghost"
              />
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
        </div>

        {/* The middle column is sized, not `auto`: `StepsSeparator` is the
            connector and it GROWS to fill, so on an `auto` column every
            connector measures 0px and the steps read as three loose chips. */}
        <StepsList className="w-auto min-w-0 @4xl:w-[24rem]">
          {STEPS.map((title, index) => (
            <StepsItem index={index} key={title}>
              <StepsTrigger>
                <StepsIndicator>{index + 1}</StepsIndicator>
                <StepsTitle className="hidden @4xl:inline">{title}</StepsTitle>
              </StepsTrigger>
              <StepsSeparator />
            </StepsItem>
          ))}
        </StepsList>

        <div className="flex items-center gap-1.5 overflow-hidden justify-self-end">
          <ValidationBadge diagnostics={diagnostics} />
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
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <StepsContent className="flex min-h-0 flex-1" index={0}>
          <StudioEditor
            connections={connections}
            onDiagnostics={setDiagnostics}
            onProgramChange={store.setScript}
            program={store.script}
            railOpen={railOpen}
            used={usedNames}
          />
        </StepsContent>

        <StepsContent className="flex min-h-0 flex-1 overflow-auto" index={1}>
          <StudioConfigure
            connections={connections}
            jobName={store.name}
            onChange={onConfigChange}
            orgConfigured={orgConfigured}
            orgName={orgIdentity?.legal_name ?? null}
            values={config}
          />
        </StepsContent>

        <StepsContent className="flex min-h-0 flex-1 overflow-auto" index={2}>
          <StudioSummary
            blocked={blocked}
            connections={connections}
            creating={submitting}
            findings={diagnostics}
            name={store.name}
            onCreate={() => {
              if (!draftMutation.isPending) confirmMutation.mutate();
            }}
            refs={refs}
            values={config}
          />
        </StepsContent>
      </div>

      {/* A STATUS strip: it reports what nothing else does, and keeps the dock
          switcher at its trailing edge. Only the Editor page has a dock, so only
          the Editor page shows the toggle. */}
      <div className="flex h-8 shrink-0 flex-row items-center gap-2 border-t px-3 text-muted-foreground text-xs">
        <span className="truncate">
          {refs.length} reference{refs.length === 1 ? "" : "s"}
          {" · "}
          {draftMutation.isPending ? "saving…" : saved ? "draft saved" : "unsaved changes"}
        </span>

        <Show when={store.step === 0}>
          <ToggleGroup
            aria-label="Panels"
            className="ms-auto"
            multiple={false}
            onValueChange={(d) => setRailOpen(d.value.length > 0)}
            size="sm"
            spacing={2}
            value={railOpen ? ["connections"] : []}
          >
            <ToggleGroupItem aria-label="Connections" value="connections">
              <PlugZap />
            </ToggleGroupItem>
          </ToggleGroup>
        </Show>
      </div>
    </Steps>
  );
}

/**
 * The tally and what it is made of — the compiler's findings, not a second
 * analysis. One check feeds the squiggles in the gutter, this badge and the gate
 * on Create; the flow this replaces had the LSP's diagnostics trapped inside the
 * editor, so Review advanced with a red program and `validating` was dead state.
 */
function ValidationBadge({ diagnostics }: { diagnostics: readonly checker.CheckRow[] }) {
  const errors = diagnostics.filter((d) => d.severity === 1).length;
  const warnings = diagnostics.length - errors;
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <Badge
          size="lg"
          variant={errors ? "destructive" : warnings ? "warning" : "success"}
        >
          {errors
            ? `${errors} error${errors === 1 ? "" : "s"}`
            : warnings
              ? `${warnings} warning${warnings === 1 ? "" : "s"}`
              : "Valid"}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 p-0">
        <div className="border-b px-3 py-2">
          <p className="font-medium text-sm">Program</p>
          <p className="text-muted-foreground text-xs">The same analysis the gutter shows.</p>
        </div>
        <Show
          fallback={<p className="px-3 py-3 text-sm">Every reference resolves and every mapping type-checks.</p>}
          when={diagnostics.length > 0}
        >
          <ScrollArea className="max-h-64">
            <ul className="divide-y">
              {diagnostics.map((d, i) => (
                <li className="flex items-start justify-between gap-3 px-3 py-1.5" key={i}>
                  <span className="shrink-0 font-medium text-xs">
                    Line {d.range.start.line + 1}
                  </span>
                  <span className="text-end text-muted-foreground text-xs">{d.message}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </Show>
      </HoverCardContent>
    </HoverCard>
  );
}
