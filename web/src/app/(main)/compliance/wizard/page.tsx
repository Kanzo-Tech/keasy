"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import { WizardLayout } from "@/components/compliance/wizard-layout";
import type { WizardStepDef } from "@/components/compliance/wizard-stepper";
import { StepKeyPair } from "@/components/compliance/steps/step-key-pair";
import { StepDidHosting } from "@/components/compliance/steps/step-did-hosting";
import { StepLrn } from "@/components/compliance/steps/step-lrn";
import { StepLegalParticipant } from "@/components/compliance/steps/step-legal-participant";
import { StepTerms } from "@/components/compliance/steps/step-terms";
import { StepGxdchSubmit } from "@/components/compliance/steps/step-gxdch-submit";

interface WizardState {
  current_step?: number;
  domain?: string;
  public_key_jwk?: object;
  did_document?: object;
  cert_chain_pem?: string;
  lrn_type?: string;
  lrn_value?: string;
  lrn_credential?: object;
  legal_name?: string;
  country_code?: string;
  legal_participant_credential?: object;
  terms_credential?: object;
  compliance_vc?: object;
  [key: string]: unknown;
}

const STEP_DEFS: WizardStepDef[] = [
  { id: "keys", label: "Key Pair Generation", description: "Generate P-256 key pair" },
  { id: "did", label: "DID Document", description: "Upload certificate chain" },
  { id: "lrn", label: "Registration Number", description: "Get LRN credential" },
  { id: "lp", label: "Legal Participant", description: "Sign LP credential" },
  { id: "tc", label: "Terms & Conditions", description: "Accept & sign T&C" },
  { id: "submit", label: "GXDCH Submission", description: "Submit for compliance" },
];

function isStepCompleted(step: number, state: WizardState): boolean {
  switch (step) {
    case 0: return !!state.public_key_jwk;
    case 1: return !!state.did_document;
    case 2: return !!state.lrn_credential;
    case 3: return !!state.legal_participant_credential;
    case 4: return !!state.terms_credential;
    case 5: return !!state.compliance_vc;
    default: return false;
  }
}

export default function ComplianceWizardPage() {
  const router = useRouter();
  const { data: wizardState, isLoading, mutate } = useSWR<WizardState>(
    "gx-wizard",
    () => fetch("/api/compliance/wizard").then((r) => r.json()).then((r) => r.data ?? r)
  );

  const [currentStep, setCurrentStep] = useState<number | null>(null);

  // Derive effective current step (from state or local override)
  const effectiveStep = currentStep ?? (wizardState?.current_step ?? 0);

  const handleStepChange = useCallback((step: number) => {
    // Only allow navigating to completed steps
    if (wizardState && isStepCompleted(step, wizardState)) {
      setCurrentStep(step);
    }
  }, [wizardState]);

  const handleComplete = useCallback(async () => {
    await mutate();
    const nextStep = effectiveStep + 1;
    if (nextStep >= STEP_DEFS.length) {
      // All steps complete — navigate to compliance page
      router.push("/compliance");
    } else {
      setCurrentStep(nextStep);
    }
  }, [effectiveStep, mutate, router]);

  const handleBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, (prev ?? effectiveStep) - 1));
  }, [effectiveStep]);

  const handleNext = useCallback(() => {
    if (wizardState && isStepCompleted(effectiveStep, wizardState)) {
      setCurrentStep(effectiveStep + 1);
    }
  }, [effectiveStep, wizardState]);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 p-4">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-6">
          <div className="w-64 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
          <div className="flex-1 space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      </div>
    );
  }

  const state = wizardState ?? {};
  const isFirstStep = effectiveStep === 0;
  const isLastStep = effectiveStep === STEP_DEFS.length - 1;
  const canNext = wizardState ? isStepCompleted(effectiveStep, state) && !isLastStep : false;

  function renderStep() {
    switch (effectiveStep) {
      case 0:
        return (
          <StepKeyPair
            onComplete={handleComplete}
            completed={isStepCompleted(0, state)}
            publicKeyJwk={state.public_key_jwk}
          />
        );
      case 1:
        return (
          <StepDidHosting
            onComplete={handleComplete}
            completed={isStepCompleted(1, state)}
            wizardState={state}
          />
        );
      case 2:
        return (
          <StepLrn
            onComplete={handleComplete}
            completed={isStepCompleted(2, state)}
            wizardState={state}
          />
        );
      case 3:
        return (
          <StepLegalParticipant
            onComplete={handleComplete}
            completed={isStepCompleted(3, state)}
            wizardState={state}
          />
        );
      case 4:
        return (
          <StepTerms
            onComplete={handleComplete}
            completed={isStepCompleted(4, state)}
            wizardState={state}
          />
        );
      case 5:
        return (
          <StepGxdchSubmit
            onComplete={handleComplete}
            completed={isStepCompleted(5, state)}
            wizardState={state}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Gaia-X Compliance Wizard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete all 6 steps to obtain your Gaia-X compliance credential.
        </p>
      </div>

      <WizardLayout
        steps={STEP_DEFS}
        currentStep={effectiveStep}
        onStepChange={handleStepChange}
        onBack={!isFirstStep ? handleBack : undefined}
        onNext={canNext ? handleNext : undefined}
        nextDisabled={!canNext}
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        nextLabel={isLastStep ? "Submit" : "Next"}
      >
        {renderStep()}
      </WizardLayout>
    </div>
  );
}
