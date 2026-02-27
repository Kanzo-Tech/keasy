"use client";

import { useState, useRef, ChangeEvent } from "react";
import { ChevronDown, ChevronUp, Upload, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface WizardState {
  terms_credential?: object;
  current_step?: number;
  [key: string]: unknown;
}

interface StepTermsProps {
  onComplete: () => void;
  completed: boolean;
  wizardState: WizardState;
}

const GAIA_X_TERMS_AND_CONDITIONS = `The PARTICIPANT signing the Self-Description agrees as follows:
- to update its descriptions about any changes, be it technical, organizational, or legal - especially but not limited to contractual in regards to the indicated attributes present in the descriptions.

The keypair used to sign Verifiable Credentials will be revoked where Gaia-X Association becomes aware of:
- a breach of the obligations of the PARTICIPANT or PROVIDER
- causes current exclusive possession of the private key to be lost
- other valid reasons

Gaia-X Association is allowed to maintain the signed Verifiable Credentials such as to verify claims (see https://www.gaia-x.eu/policies & documentation).`;

export function StepTerms({ onComplete, completed, wizardState }: StepTermsProps) {
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
    if (!privateKeyPem) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/compliance/wizard/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ private_key_pem: privateKeyPem }),
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
        <h2 className="text-lg font-semibold">Terms &amp; Conditions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Review and sign the Gaia-X Terms &amp; Conditions credential.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* T&C text */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Gaia-X Terms &amp; Conditions
          </p>
          <ScrollArea className="h-40 rounded border bg-muted/30 p-3">
            <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">
              {GAIA_X_TERMS_AND_CONDITIONS}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tc-private-key">Private Key (.pem)</Label>
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
            id="tc-private-key"
            className="hidden"
            onChange={handleKeyFileChange}
          />
          <p className="text-xs text-muted-foreground">
            The private key is used to sign the credential in-memory and is not stored on the server.
          </p>
        </div>

        <Button
          type="submit"
          disabled={loading || !privateKeyPem}
          className="gap-2"
        >
          <FileCheck className="h-4 w-4" />
          {loading ? "Signing..." : "Accept & Sign Terms"}
        </Button>
      </form>

      {/* Existing credential */}
      {completed && wizardState.terms_credential && (
        <Collapsible open={credentialOpen} onOpenChange={setCredentialOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              {credentialOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              View T&amp;C Credential
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 bg-muted rounded-md p-3 text-xs overflow-auto max-h-64 font-mono">
              {JSON.stringify(wizardState.terms_credential, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
