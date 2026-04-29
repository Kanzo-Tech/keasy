"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { PageShell } from "@/components/layout/page-shell";
import { ComingSoon } from "@/components/shared/coming-soon";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunMode } from "@/lib/types";

interface StepConfigProps {
  name: string;
  onNameChange: (name: string) => void;
  mode: RunMode;
  onModeChange: (mode: RunMode) => void;
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
        <Field>
          <FieldLabel>
            Job Name <span className="text-muted-foreground text-xs">(optional)</span>
          </FieldLabel>
          <FieldContent>
            <Input
              type="text"
              placeholder="Optional name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>Run Mode</FieldLabel>
          <FieldContent>
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
          </FieldContent>
        </Field>

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
