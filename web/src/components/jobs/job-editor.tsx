"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FormField, FormActions } from "@/components/shared/form-layout";
import { JobSummaryPanel } from "@/components/jobs/job-summary-dialog";
import { CodeEditor } from "@/components/discovery/code-editor";
import { cn } from "@/lib/utils";
import { ComingSoon } from "@/components/shared/coming-soon";
import { Save, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { RunMode, ValidationResult } from "@/lib/types";

export function JobEditor() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");

  const [script, setScript] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<RunMode>("integrated");
  const [showSummary, setShowSummary] = useState(false);
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

  useEffect(() => {
    if (!draftJob || draftJob.status !== "draft") return;
    if (draftJob.script) setScript(draftJob.script);
    if (draftJob.name) setName(draftJob.name);
    setMode(draftJob.mode);
  }, [draftJob]);

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

  async function handleReview() {
    setValidating(true);
    try {
      const result = await api.scripts.validate(script);
      if (!result.valid) {
        result.errors.forEach((err) => toastError(err));
        return;
      }
      setValidation(result);
      setShowSummary(true);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Failed to validate script",
      );
    } finally {
      setValidating(false);
    }
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const jobName = name.trim() || undefined;
      const connectionIds = connections
        .filter((s) => script.includes(`@${s.name}/`))
        .map((s) => s.id);

      // Delete the draft before creating the real job
      if (draftId) {
        await api.jobs.remove(draftId).catch(() => {});
      }

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

  if (showSummary && validation) {
    return (
      <JobSummaryPanel
        onConfirm={handleConfirm}
        onCancel={() => setShowSummary(false)}
        submitting={submitting}
        jobName={name.trim()}
        mode={mode}
        validation={validation}
        dcatEnabled={dcatEnabled}
        onDcatToggle={setDcatEnabled}
        orgConfigured={orgConfigured}
        connections={connections}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex flex-col gap-4 shrink-0">
        <FormField label="Job Name">
          <Input
            type="text"
            placeholder="Optional name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <FormField label="Run Mode">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as RunMode)}
            className="flex gap-2"
          >
            <Label
              htmlFor="mode-integrated"
              className={cn(
                "flex-1 flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors cursor-pointer",
                mode === "integrated"
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-muted-foreground/30",
              )}
            >
              <RadioGroupItem value="integrated" id="mode-integrated" />
              <span className="text-sm font-medium">Integrated</span>
              <span className="text-xs text-muted-foreground ml-auto">
                Runs immediately
              </span>
            </Label>
            <ComingSoon placement="inline" className="flex-1">
              <Label
                htmlFor="mode-scheduled"
                className="flex items-center gap-3 rounded-lg border border-border p-2.5 text-left"
              >
                <RadioGroupItem
                  value="scheduled"
                  id="mode-scheduled"
                  disabled
                />
                <span className="text-sm font-medium">Scheduled</span>
              </Label>
            </ComingSoon>
          </RadioGroup>
        </FormField>
      </div>

      <Tabs defaultValue="script" className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <TabsList>
            <TabsTrigger value="script">Script</TabsTrigger>
            <ComingSoon>
              <TabsTrigger value="visual" disabled>
                Visual
              </TabsTrigger>
            </ComingSoon>
          </TabsList>
          <div className="flex items-center gap-2">
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
                  onClick={handleSaveDraft}
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
        <TabsContent value="script" className="mt-0 flex-1 min-h-0 flex flex-col">
          <CodeEditor
            value={script}
            onChange={setScript}
            connections={connections}
            providers={providers}
            placeholder="Write your fossil script here..."
            className="flex-1"
          />
        </TabsContent>
      </Tabs>

      <FormActions>
        <div />
        <Button
          onClick={handleReview}
          disabled={!script.trim() || validating}
        >
          {validating ? "Validating..." : "Review & Submit"}
        </Button>
      </FormActions>
    </div>
  );
}
