"use client";

import { useMemo } from "react";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
  createListCollection,
} from "@kanzo-tech/ui";
import { FormField } from "@/components/shared/form-layout";
import { PageShell } from "@/components/layout/page-shell";
import { ComingSoon } from "@/components/shared/coming-soon";
import { ArrowLeft } from "lucide-react";
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
  const sinkCollection = useMemo(
    () =>
      createListCollection({
        items: connections.map((c) => ({ label: `${c.name} — ${c.url}`, value: c.id })),
      }),
    [connections],
  );

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
            columns={2}
            onValueChange={(details) => onModeChange((details.value ?? "integrated") as RunMode)}
            value={mode}
          >
            <RadioGroupCard value="integrated">
              <RadioGroupText className="font-medium text-sm">Integrated</RadioGroupText>
              <span className="ms-auto text-muted-foreground text-xs">Runs immediately</span>
            </RadioGroupCard>
            <ComingSoon placement="inline">
              <RadioGroupCard className="h-full" disabled value="scheduled">
                <RadioGroupText className="font-medium text-sm">Scheduled</RadioGroupText>
              </RadioGroupCard>
            </ComingSoon>
          </RadioGroup>
        </FormField>

        <FormField label="Output destination">
          <Select
            collection={sinkCollection}
            onValueChange={(details) => onSinkChange(details.value[0] ?? "")}
            value={sinkConnectionId ? [sinkConnectionId] : []}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Where to save the generated graph…" />
            </SelectTrigger>
            <SelectContent>
              {sinkCollection.items.map((item) => (
                <SelectItem item={item} key={item.value}>
                  {item.label}
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
        <Field
          className={cn(
            "flex-row items-center justify-between rounded-lg border p-3 transition-colors",
            !orgConfigured
              ? "border-border opacity-50"
              : dcatEnabled
                ? "border-primary/50 bg-primary/5"
                : "border-border",
          )}
          disabled={!orgConfigured}
        >
          <div className="space-y-0.5">
            <FieldLabel className="font-medium text-sm">DCAT-AP Catalog</FieldLabel>
            <p className="text-muted-foreground text-xs">
              {orgConfigured
                ? "Generate a DCAT-AP metadata record for the published datasets"
                : "Requires organization identity to be configured"}
            </p>
          </div>
          <Switch
            checked={dcatEnabled && orgConfigured}
            disabled={!orgConfigured}
            onCheckedChange={(details) => onDcatToggle(details.checked)}
          />
        </Field>
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
