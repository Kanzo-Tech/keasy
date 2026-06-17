"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/shared/form-layout";
import { PageShell } from "@/components/layout/page-shell";
import { ComingSoon } from "@/components/shared/coming-soon";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunMode, Connection } from "@/lib/types";

interface StepConfigProps {
  name: string;
  onNameChange: (name: string) => void;
  mode: RunMode;
  onModeChange: (mode: RunMode) => void;
  connections: Connection[];
  sinkConnectionId: string | null;
  onSinkChange: (id: string) => void;
  dcatEnabled: boolean;
  onDcatToggle: (enabled: boolean) => void;
  orgConfigured: boolean;
  onBack: () => void;
  onReview: () => void;
  validating: boolean;
}

export function StepConfig({
  name,
  onNameChange,
  mode,
  onModeChange,
  connections,
  sinkConnectionId,
  onSinkChange,
  dcatEnabled,
  onDcatToggle,
  orgConfigured,
  onBack,
  onReview,
  validating,
}: StepConfigProps) {
  return (
    <PageShell>
      <PageShell.Content>
        <FormField label="Job Name" optional>
          <Input
            type="text"
            placeholder="Optional name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </FormField>

        <FormField label="Run Mode">
          <RadioGroup
            value={mode}
            onValueChange={(v) => onModeChange(v as RunMode)}
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

        <FormField label="Output destination">
          <Select value={sinkConnectionId ?? undefined} onValueChange={onSinkChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Where to save the generated graph…" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} — {c.url}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            {connections.length === 0
              ? "No connections yet — add one in Connections to choose a destination."
              : "The output lands under this connection: {destination}/{job id}."}
          </p>
        </FormField>

        {/* DCAT toggle */}
        <div
          className={cn(
            "flex items-center justify-between rounded-lg border p-3 transition-colors",
            !orgConfigured
              ? "border-border opacity-50"
              : dcatEnabled
                ? "border-primary/50 bg-primary/5"
                : "border-border",
          )}
        >
          <div className="space-y-0.5">
            <Label htmlFor="dcat-toggle" className="text-sm font-medium">
              DCAT-AP Catalog
            </Label>
            <p className="text-xs text-muted-foreground">
              {orgConfigured
                ? "Generate a DCAT-AP metadata record for the published datasets"
                : "Requires organization identity to be configured"}
            </p>
          </div>
          <Switch
            id="dcat-toggle"
            checked={dcatEnabled && orgConfigured}
            onCheckedChange={(checked) => onDcatToggle(checked)}
            disabled={!orgConfigured}
          />
        </div>
      </PageShell.Content>
      <PageShell.Footer>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back
        </Button>
        <Button onClick={onReview} disabled={validating}>
          {validating ? "Validating..." : "Review & Submit"}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
