"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { queryKeys } from "@/lib/query-keys";
import { api } from "@/lib/api";
import { ModePicker } from "@/components/jobs/mode-picker";
import { StepScript } from "@/components/jobs/step-script";
import { StepConfig } from "@/components/jobs/step-config";
import { JobSummaryPanel } from "@/components/jobs/job-summary-dialog";
import { StepIndicator } from "@/components/shared/step-indicator";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
import { useJobEditorStore } from "./job-editor-store";

const STEP_LABELS = ["Script", "Configure", "Review"] as const;

export function JobEditor() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");

  // Zustand store — replaces 8 useState
  const store = useJobEditorStore();

  const { data: orgIdentity } = useQuery({ queryKey: queryKeys.org.identity, queryFn: api.org.identity });
  const { data: connections = [] } = useQuery({ queryKey: queryKeys.connections.all(), queryFn: () => api.connections.list() });
  const { data: providers = [] } = useQuery({ queryKey: queryKeys.settings.providers, queryFn: api.settings.providers });

  const orgConfigured = orgIdentity != null && !!orgIdentity.legal_name;

  // A job's connections are its program's `@conn` references — derived from
  // fossil's typed lineage (`/v1/refs`), which sees `@conn` in data, schema, AND
  // select positions. This replaces a regex over the script text (which only saw
  // the positional data URI and missed `schema =`/`select =` vocab connections).
  const connectionIdsForScript = async (script: string): Promise<string[] | undefined> => {
    const refs = await api.refs(script);
    const names = new Set(refs.map((r) => r.connection).filter((c): c is string => !!c));
    const ids = connections.filter((s) => names.has(s.name)).map((s) => s.id);
    return ids.length > 0 ? ids : undefined;
  };

  useEffect(() => {
    if (orgConfigured) store.setDcatEnabled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgConfigured]);

  const { data: draftJob } = useQuery({
    queryKey: queryKeys.jobs.detail(draftId!),
    queryFn: () => api.jobs.get(draftId!),
    enabled: !!draftId,
  });

  // Restore draft
  useEffect(() => {
    if (!draftJob || draftJob.status !== "draft") return;
    store.restoreDraft(draftJob.script ?? "", draftJob.name ?? "", draftJob.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJob]);

  // Reset store on unmount
  useEffect(() => () => useJobEditorStore.getState().reset(), []);

  // ── Handlers ──────────────────────────────────────────────────────────
  // No server-side validate round-trip: the editor's browser LSP validates the
  // program inline as the user types (errors surface there), so "Review" just
  // advances the wizard. The output structure (types/destinations) is shown
  // from the run manifest once the job completes, not pre-submit.

  const draftMutation = useMutation({
    mutationFn: async () => {
      if (draftId) {
        await api.jobs.update(draftId, {
          script: store.script,
          name: store.name.trim() || undefined,
        });
        return "updated";
      } else {
        await api.jobs.create({
          script: store.script,
          name: store.name.trim() || undefined,
          mode: store.mode,
          draft: true,
          connection_ids: await connectionIdsForScript(store.script),
        });
        return "created";
      }
    },
    onSuccess: async (result) => {
      toast.success(result === "updated" ? "Draft updated" : "Draft saved");
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      router.push("/jobs");
    },
    onError: (err) => toastError(err, "Failed to save draft"),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const jobName = store.name.trim() || undefined;
      const connectionIds = await connectionIdsForScript(store.script);

      if (draftId) {
        await api.jobs.remove(draftId).catch(() => {});
      }

      return api.jobs.create({
        script: store.script,
        name: jobName,
        mode: store.mode,
        dcat_enabled: store.dcatEnabled || undefined,
        connection_ids: connectionIds,
      });
    },
    onSuccess: async (job) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      router.push(`/jobs/${job.id}`);
    },
    onError: (err) => toastError(err, "Failed to create job"),
  });

  const isDirty = !!(store.script || store.name) && !draftJob && !confirmMutation.isPending && !draftMutation.isPending;

  // ── Render ────────────────────────────────────────────────────────────

  if (store.step === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <UnsavedChangesGuard isDirty={isDirty} />
        <ModePicker onSelect={store.selectMode} />
      </div>
    );
  }

  if (store.step === 3) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <UnsavedChangesGuard isDirty={isDirty} />
        <div className="shrink-0 px-4 pt-4">
          <StepIndicator steps={STEP_LABELS} current={2} />
        </div>
        <JobSummaryPanel
          onConfirm={() => { if (!draftMutation.isPending) confirmMutation.mutate(); }}
          onCancel={store.goBack}
          submitting={confirmMutation.isPending || confirmMutation.isSuccess}
          jobName={store.name.trim()}
          mode={store.mode}
          dcatEnabled={store.dcatEnabled}
        />
      </div>
    );
  }

  if (store.step === 2) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <UnsavedChangesGuard isDirty={isDirty} />
        <div className="shrink-0 px-4 pt-4">
          <StepIndicator steps={STEP_LABELS} current={1} />
        </div>
        <StepConfig
          name={store.name}
          onNameChange={store.setName}
          mode={store.mode}
          onModeChange={store.setMode}
          dcatEnabled={store.dcatEnabled}
          onDcatToggle={store.setDcatEnabled}
          orgConfigured={orgConfigured}
          onBack={store.goBack}
          onReview={store.goToReview}
          validating={store.validating}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <UnsavedChangesGuard isDirty={isDirty} />
      {store.creationMode === "studio" && (
        <div className="shrink-0 px-4 pt-4">
          <StepIndicator steps={STEP_LABELS} current={0} />
        </div>
      )}
      <StepScript
        creationMode={store.creationMode!}
        script={store.script}
        onScriptChange={store.setScript}
        connections={connections}
        providers={providers}
        onNext={store.goToConfig}
        onBack={store.goBack}
        savingDraft={draftMutation.isPending || draftMutation.isSuccess}
        onSaveDraft={() => { if (!confirmMutation.isPending) draftMutation.mutate(); }}
        onAssistantComplete={store.completeAssistant}
      />
    </div>
  );
}
