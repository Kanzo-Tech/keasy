"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, AlertCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api, ApiError } from "@/lib/api";
import type { WizardState } from "@/lib/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface StepGxdchSubmitProps {
  onComplete: () => void;
  completed: boolean;
  wizardState: WizardState;
}

type SubmitPhase = "idle" | "assembling" | "submitting" | "verifying" | "complete" | "error";

function CredentialPreview({ title, credential }: { title: string; credential: object }) {
  const [open, setOpen] = useState(false);
  const vc = credential as Record<string, unknown>;
  const issuer = typeof vc.issuer === "string" ? vc.issuer : JSON.stringify(vc.issuer ?? "—");
  const issuanceDate = typeof vc.issuanceDate === "string" ? vc.issuanceDate : "—";

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">
              Issuer: <span className="font-mono truncate max-w-xs inline-block align-bottom">{issuer}</span>
            </p>
            {issuanceDate !== "—" && (
              <p className="text-xs text-muted-foreground">
                Issued: {new Date(issuanceDate).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs px-2">
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              View Raw JSON
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 bg-muted rounded-md p-3 text-xs overflow-auto max-h-48 font-mono">
              {JSON.stringify(credential, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

const PHASE_MESSAGES: Record<SubmitPhase, string> = {
  idle: "",
  assembling: "Assembling Verifiable Presentation...",
  submitting: "Submitting to GXDCH...",
  verifying: "Awaiting verification...",
  complete: "Complete!",
  error: "",
};

export function StepGxdchSubmit({ onComplete, completed, wizardState }: StepGxdchSubmitProps) {
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [complianceOpen, setComplianceOpen] = useState(false);

  const hasAllCredentials =
    wizardState.lrn_credential &&
    wizardState.lp_credential &&
    wizardState.tc_credential;

  async function handleSubmit() {
    setPhase("assembling");
    setError(null);

    // Brief delay to show "assembling" UI stage
    await new Promise((r) => setTimeout(r, 600));
    setPhase("submitting");

    try {
      await api.gaiax.wizard.submit();
      setPhase("verifying");
      setPhase("complete");
      onComplete();
    } catch (err) {
      setPhase("error");
      setError(err instanceof ApiError ? err.message : "GXDCH submission failed");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">GXDCH Submission</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Review your credentials and submit the Verifiable Presentation to GXDCH.
        </p>
      </div>

      {/* Credential summaries */}
      {wizardState.lrn_credential && (
        <CredentialPreview title="LRN Credential" credential={wizardState.lrn_credential} />
      )}
      {wizardState.lp_credential && (
        <CredentialPreview
          title="Legal Participant Credential"
          credential={wizardState.lp_credential}
        />
      )}
      {wizardState.tc_credential && (
        <CredentialPreview
          title="Terms & Conditions Credential"
          credential={wizardState.tc_credential}
        />
      )}

      {!hasAllCredentials && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Complete all previous steps to enable submission. Missing credentials will be indicated above.
          </AlertDescription>
        </Alert>
      )}

      {/* Submission progress */}
      {phase !== "idle" && phase !== "error" && (
        <div className="space-y-2 rounded-lg border p-4">
          {(["assembling", "submitting", "verifying", "complete"] as SubmitPhase[]).map((p) => {
            const order = ["assembling", "submitting", "verifying", "complete"];
            const currentIndex = order.indexOf(phase);
            const itemIndex = order.indexOf(p);
            const isDone = itemIndex < currentIndex || phase === "complete";
            const isCurrent = p === phase && phase !== "complete";

            return (
              <div key={p} className="flex items-center gap-2 text-sm">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${
                    isDone
                      ? "bg-emerald-600 text-white"
                      : isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isDone ? <Check className="h-3 w-3" /> : itemIndex + 1}
                </span>
                <span
                  className={
                    isDone || isCurrent
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {PHASE_MESSAGES[p]}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Error state */}
      {phase === "error" && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium mb-1">Submission failed</p>
            <p>{error}</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Already completed */}
      {completed && wizardState.compliance_vc && phase !== "complete" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-emerald-700">
              <Check className="h-4 w-4" />
              Compliance Credential Issued
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Your organization is Gaia-X compliant. The compliance credential has been issued by GXDCH.
            </p>
            <Collapsible open={complianceOpen} onOpenChange={setComplianceOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  {complianceOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  View Compliance Credential
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 bg-muted rounded-md p-3 text-xs overflow-auto max-h-64 font-mono">
                  {JSON.stringify(wizardState.compliance_vc, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      )}

      {/* Submit button */}
      {!completed && (
        <Button
          onClick={handleSubmit}
          disabled={!hasAllCredentials || (phase !== "idle" && phase !== "error")}
          className="gap-2"
        >
          <Send className="h-4 w-4" />
          {phase === "error" ? "Retry Submission" : "Submit to GXDCH"}
        </Button>
      )}
    </div>
  );
}
