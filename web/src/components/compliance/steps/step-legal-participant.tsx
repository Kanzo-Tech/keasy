"use client";

import { useState, useRef, ChangeEvent } from "react";
import { ChevronDown, ChevronUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FormField } from "@/components/shared/form-layout";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface WizardState {
  lp_credential?: object;
  legal_name?: string;
  country_code?: string;
  current_step?: number;
  [key: string]: unknown;
}

interface StepLegalParticipantProps {
  onComplete: () => void;
  completed: boolean;
  wizardState: WizardState;
}

export function StepLegalParticipant({ onComplete, completed, wizardState }: StepLegalParticipantProps) {
  const [legalName, setLegalName] = useState(wizardState.legal_name ?? "");
  const [countryCode, setCountryCode] = useState(wizardState.country_code ?? "");
  const [privateKeyPem, setPrivateKeyPem] = useState<string | null>(null);
  const [keyFileName, setKeyFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleKeyFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setPrivateKeyPem(text);
    setKeyFileName(file.name);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!legalName.trim() || !countryCode.trim() || !privateKeyPem) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/v1/gaia-x/wizard/legal-participant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legal_name: legalName.trim(),
          country_code: countryCode.trim(),
          private_key_pem: privateKeyPem,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? `Request failed with status ${res.status}`);
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Legal Participant Credential</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Sign a Gaia-X Legal Participant credential for your organization.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Legal Name">
          <Input
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="e.g. Acme Corporation GmbH"
          />
        </FormField>

        <FormField
          label="Country Subdivision Code"
          description="ISO 3166-2 country subdivision code (country + region, e.g., DE-BY for Bavaria, Germany)."
        >
          <Input
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            placeholder="e.g. DE-BY"
          />
        </FormField>

        <FormField
          label="Private Key (.pem)"
          description="The private key is used to sign the credential in-memory and is not stored on the server."
        >
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              {keyFileName ?? "Upload private key"}
            </Button>
            {keyFileName && (
              <span className="text-xs text-muted-foreground truncate max-w-48">{keyFileName}</span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pem"
            className="hidden"
            onChange={handleKeyFileChange}
          />
        </FormField>

        <Button
          type="submit"
          disabled={loading || !legalName.trim() || !countryCode.trim() || !privateKeyPem}
        >
          {loading ? "Signing..." : "Sign Legal Participant Credential"}
        </Button>
      </form>

      {/* Existing credential */}
      {completed && wizardState.lp_credential && (
        <Collapsible open={credentialOpen} onOpenChange={setCredentialOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              {credentialOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              View Legal Participant Credential
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 bg-muted rounded-md p-3 text-xs overflow-auto max-h-64 font-mono">
              {JSON.stringify(wizardState.lp_credential, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
