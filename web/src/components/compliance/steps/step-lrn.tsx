"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { FormField } from "@/components/shared/form-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api, ApiError } from "@/lib/api";
import type { WizardState } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface StepLrnProps {
  onComplete: () => void;
  completed: boolean;
  wizardState: WizardState;
}

const LRN_TYPES = [
  { value: "vatID", label: "VAT ID (VIES)", registry: "VIES EU VAT registry" },
  { value: "leiCode", label: "LEI Code (GLEIF)", registry: "GLEIF registry" },
  { value: "EORI", label: "EORI (European Commission)", registry: "European Commission EORI registry" },
] as const;

export function StepLrn({ onComplete, completed, wizardState }: StepLrnProps) {
  const [lrnType, setLrnType] = useState<string>(wizardState.lrn_type ?? "");
  const [lrnValue, setLrnValue] = useState(wizardState.lrn_value ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentialOpen, setCredentialOpen] = useState(false);

  const selectedType = LRN_TYPES.find((t) => t.value === lrnType);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lrnType || !lrnValue.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await api.gaiax.wizard.requestLrn(lrnType, lrnValue.trim());
      onComplete();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Legal Registration Number</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Provide your legal registration number to obtain an LRN credential from the GXDCH Notary.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Registration Number Type">
          <Select value={lrnType} onValueChange={setLrnType}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a registry type" />
            </SelectTrigger>
            <SelectContent>
              {LRN_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="Registration Number">
          <Input
            value={lrnValue}
            onChange={(e) => setLrnValue(e.target.value)}
            placeholder="e.g. DE123456789"
          />
        </FormField>

        {selectedType && (
          <p className="text-sm text-muted-foreground">
            Your registration number will be verified by the GXDCH Notary against the{" "}
            <strong>{selectedType.registry}</strong>.
          </p>
        )}

        <Button
          type="submit"
          disabled={loading || !lrnType || !lrnValue.trim()}
        >
          {loading ? "Requesting..." : "Request LRN Credential"}
        </Button>
      </form>

      {/* Existing credential display */}
      {completed && wizardState.lrn_credential && (
        <Collapsible open={credentialOpen} onOpenChange={setCredentialOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              {credentialOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              View LRN Credential
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 bg-muted rounded-md p-3 text-xs overflow-auto max-h-64 font-mono">
              {JSON.stringify(wizardState.lrn_credential, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
