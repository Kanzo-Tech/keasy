"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import type { RunMode, ValidationResult, CreationMode } from "@/lib/types";

const STEP_LABELS = ["Script", "Configure", "Review"] as const;

export function JobEditor() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");

  const [step, setStep] = useState(0); // 0=mode, 1=script, 2=config, 3=review
  const [creationMode, setCreationMode] = useState<CreationMode | null>(null);
  const [script, setScript] = useState("");
  const [shex, setShex] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<RunMode>("integrated");
  const [submitting, setSubmitting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [dcatEnabled, setDcatEnabled] = useState(false);

  const { data: orgIdentity } = useQuery({ queryKey: queryKeys.org.identity, queryFn: api.org.identity });
  const { data: connections = [] } = useQuery({ queryKey: queryKeys.connections.all(), queryFn: () => api.connections.list() });
  const { data: providers = [] } = useQuery({ queryKey: queryKeys.settings.providers, queryFn: api.settings.providers });

  const orgConfigured = orgIdentity != null && !!orgIdentity.legal_name;

  useEffect(() => {
    if (orgConfigured) setDcatEnabled(true);
  }, [orgConfigured]);

  const { data: draftJob } = useQuery({
    queryKey: queryKeys.jobs.detail(draftId!),
    queryFn: () => api.jobs.get(draftId!),
    enabled: !!draftId,
  });

  // Restore draft → skip mode picker, go to studio
  useEffect(() => {
    if (!draftJob || draftJob.status !== "draft") return;
    if (draftJob.script) setScript(draftJob.script);
    if (draftJob.name) setName(draftJob.name);
    setMode(draftJob.mode);
    setCreationMode("studio");
    setStep(1);
  }, [draftJob]);

  // ── Handlers ──────────────────────────────────────────────────────────

  function handleModeSelect(m: CreationMode) {
    setCreationMode(m);
    setStep(1);
  }

  function handleAssistantComplete(generatedScript: string, generatedShex: string) {
    setScript(generatedScript);
    setShex(generatedShex);
    setCreationMode("studio");
    // stay on step 1, now in studio mode
  }

  function handleScriptNext() {
    setStep(2);
  }

  function handleScriptBack() {
    setCreationMode(null);
    setStep(0);
  }

  async function handleConfigReview() {
    setValidating(true);
    try {
      const result = await api.scripts.validate(script);
      if (!result.valid) {
        result.errors.forEach((err) => toastError(err));
        return;
      }
      setValidation(result);
      setStep(3);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to validate script");
    } finally {
      setValidating(false);
    }
  }

  function handleConfigBack() {
    setStep(1);
  }

  function handleSummaryBack() {
    setStep(2);
    setValidation(null);
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    try {
      if (draftId) {
        await api.jobs.update(draftId, {
          script,
          name: name.trim() || undefined,
        });
        toast.success("Draft updated");
      } else {
        const connectionIds = connections
          .filter((s) => script.includes(`@${s.name}/`))
          .map((s) => s.id);
        await api.jobs.create({
          script,
          name: name.trim() || undefined,
          mode,
          draft: true,
          connection_ids: connectionIds.length > 0 ? connectionIds : undefined,
        });
        toast.success("Draft saved");
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      router.push("/jobs");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const jobName = name.trim() || undefined;
      const connectionIds = connections
        .filter((s) => script.includes(`@${s.name}/`))
        .map((s) => s.id);

      // Upload shex to the connection referenced in the script (shex!(@conn/path))
      const shexMatch = shex.trim() ? script.match(/shex!\(@([^/]+)\/([^)]+)\)/) : null;
      const shexConn = shexMatch
        ? connections.find((c) => c.name === shexMatch[1])
        : null;

      await Promise.all([
        shexConn
          ? api.connections.upload(shexConn.id, shexMatch![2], shex)
          : undefined,
        draftId ? api.jobs.remove(draftId).catch(() => {}) : undefined,
      ]);

      const job = await api.jobs.create({
        script,
        name: jobName,
        mode,
        pipeline: validation?.pipeline,
        dcat_enabled: dcatEnabled || undefined,
        connection_ids: connectionIds.length > 0 ? connectionIds : undefined,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to create job");
      setSubmitting(false);
    }
  }

  const isDirty = !!(script || name) && !draftJob && !submitting && !savingDraft;

  // ── Render ────────────────────────────────────────────────────────────

  // Step 0: Mode picker
  if (step === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <UnsavedChangesGuard isDirty={isDirty} />
        <ModePicker onSelect={handleModeSelect} />
      </div>
    );
  }

  // Step 3: Review
  if (step === 3 && validation) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <UnsavedChangesGuard isDirty={isDirty} />
        <div className="shrink-0 px-4 pt-4">
          <StepIndicator steps={STEP_LABELS} current={2} />
        </div>
        <JobSummaryPanel
          onConfirm={handleConfirm}
          onCancel={handleSummaryBack}
          submitting={submitting}
          jobName={name.trim()}
          mode={mode}
          validation={validation}
          dcatEnabled={dcatEnabled}
          connections={connections}
        />
      </div>
    );
  }

  // Step 2: Config
  if (step === 2) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <UnsavedChangesGuard isDirty={isDirty} />
        <div className="shrink-0 px-4 pt-4">
          <StepIndicator steps={STEP_LABELS} current={1} />
        </div>
        <StepConfig
          name={name}
          onNameChange={setName}
          mode={mode}
          onModeChange={setMode}
          dcatEnabled={dcatEnabled}
          onDcatToggle={setDcatEnabled}
          orgConfigured={orgConfigured}
          onBack={handleConfigBack}
          onReview={handleConfigReview}
          validating={validating}
        />
      </div>
    );
  }

  // Step 1: Script (studio or assistant)
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <UnsavedChangesGuard isDirty={isDirty} />
      {creationMode === "studio" && (
        <div className="shrink-0 px-4 pt-4">
          <StepIndicator steps={STEP_LABELS} current={0} />
        </div>
      )}
      <StepScript
        creationMode={creationMode!}
        script={script}
        onScriptChange={setScript}
        shex={shex}
        onShexChange={setShex}
        connections={connections}
        providers={providers}
        onNext={handleScriptNext}
        onBack={handleScriptBack}
        savingDraft={savingDraft}
        onSaveDraft={handleSaveDraft}
        onAssistantComplete={handleAssistantComplete}
      />
    </div>
  );
}
