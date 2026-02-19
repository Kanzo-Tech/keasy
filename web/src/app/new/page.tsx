"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { JobSummaryPanel } from "@/components/job-summary-dialog";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { CloudAccountPicker } from "@/components/cloud-account-picker";
import {
  createJob,
  validateScript,
  fetchOrgSettings,
  fetchCloudAccounts,
  fetchSchema,
} from "@/lib/api";
import type { RunMode, ValidationResult, CloudAccountSummary, ProviderSchema } from "@/lib/types";

export default function NewJobPage() {
  const router = useRouter();
  const [script, setScript] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<RunMode>("integrated");
  const [showSummary, setShowSummary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dcatEnabled, setDcatEnabled] = useState(false);
  const [orgConfigured, setOrgConfigured] = useState(false);

  const [accounts, setAccounts] = useState<CloudAccountSummary[]>([]);
  const [schema, setSchema] = useState<ProviderSchema[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  useEffect(() => {
    fetchOrgSettings()
      .then((settings) => {
        const configured = settings != null && !!settings.publisher_name;
        setOrgConfigured(configured);
        if (configured) setDcatEnabled(true);
      })
      .catch(() => {});

    Promise.all([fetchCloudAccounts(), fetchSchema()])
      .then(([accts, s]) => {
        setAccounts(accts);
        setSchema(s);
        setSelectedAccountIds(accts.map((a) => a.id));
      })
      .catch(() => {});
  }, []);

  const readFile = useCallback((file: File) => {
    if (!file.name.endsWith(".fossil")) {
      toast.error("Only .fossil files are accepted");
      return;
    }
    setFileName(file.name);
    file.text().then((text) => setScript(text));
  }, []);

  async function handleReview() {
    setValidating(true);
    try {
      const result = await validateScript(script);
      if (!result.valid) {
        result.errors.forEach((err) => toastError(err));
        return;
      }
      setValidation(result);
      setShowSummary(true);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Failed to validate script"
      );
    } finally {
      setValidating(false);
    }
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const jobName = name.trim() || undefined;
      const job = await createJob({
        script,
        name: jobName,
        mode,
        sources: validation?.sources,
        outputs: validation?.outputs,
        dcat_enabled: dcatEnabled || undefined,
        cloud_account_ids: selectedAccountIds.length > 0 ? selectedAccountIds : undefined,
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Failed to create job"
      );
      setSubmitting(false);
    }
  }

  if (showSummary && validation) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="New Job" />
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
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="New Job" />
      <div className="flex flex-col gap-4 flex-1 min-h-0">
        <div className="space-y-1">
          <Label>Job Name</Label>
          <Input
            type="text"
            placeholder="Optional name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label>Run Mode</Label>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as RunMode)}
            className="flex gap-2"
          >
            <label
              className={cn(
                "flex-1 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer",
                mode === "integrated"
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              )}
            >
              <RadioGroupItem value="integrated" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium leading-none">Integrated</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Runs immediately on submit
                </p>
              </div>
            </label>
            <div
              className="flex-1 flex items-start gap-3 rounded-lg border p-3 text-left border-border opacity-50 cursor-not-allowed"
            >
              <RadioGroupItem value="scheduled" disabled className="mt-0.5" />
              <div>
                <p className="text-sm font-medium leading-none">Scheduled</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Runs on a configured schedule — Coming soon
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>

        {accounts.length > 0 && (
          <div className="space-y-2">
            <Label>Cloud Accounts</Label>
            <p className="text-xs text-muted-foreground">
              Select which cloud accounts this job may access.
            </p>
            <CloudAccountPicker
              schema={schema}
              accounts={accounts}
              value={selectedAccountIds}
              onChange={setSelectedAccountIds}
            />
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) readFile(file);
          }}
          className={`flex-1 min-h-[200px] flex flex-col items-center justify-center rounded-md border-2 border-dashed transition-colors ${
            isDragging
              ? "border-primary bg-accent"
              : fileName
                ? "border-primary/50 bg-primary/5"
                : "border-border"
          }`}
        >
          {fileName ? (
            <div className="text-center">
              <p className="font-medium">{fileName}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {script.split("\n").length} lines
              </p>
              <label className="mt-3 inline-block cursor-pointer text-sm text-primary hover:underline">
                Replace file
                <input
                  type="file"
                  className="hidden"
                  accept=".fossil"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) readFile(file);
                  }}
                />
              </label>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-muted-foreground">
                Drag & drop a <span className="font-mono">.fossil</span> file
                here
              </p>
              <label className="mt-2 inline-block cursor-pointer text-sm text-primary hover:underline">
                or browse files
                <input
                  type="file"
                  className="hidden"
                  accept=".fossil"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) readFile(file);
                  }}
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex justify-end shrink-0 pt-2">
          <Button
            onClick={handleReview}
            disabled={!script.trim() || validating}
          >
            {validating ? "Validating..." : "Review & Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
