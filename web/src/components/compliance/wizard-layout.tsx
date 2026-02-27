"use client";

import { Button } from "@/components/ui/button";
import { WizardStepper, type WizardStepDef } from "@/components/compliance/wizard-stepper";

interface WizardLayoutProps {
  steps: WizardStepDef[];
  currentStep: number;
  onStepChange: (step: number) => void;
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  isFirstStep?: boolean;
  isLastStep?: boolean;
}

export function WizardLayout({
  steps,
  currentStep,
  onStepChange,
  children,
  onBack,
  onNext,
  nextDisabled,
  nextLabel,
  isFirstStep,
  isLastStep,
}: WizardLayoutProps) {
  return (
    <div className="flex gap-6 min-h-[600px]">
      {/* Left sidebar — stepper */}
      <aside className="w-64 shrink-0">
        <WizardStepper
          steps={steps}
          currentStep={currentStep}
          onStepClick={onStepChange}
        />
      </aside>

      {/* Right content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1">{children}</div>

        {/* Navigation buttons */}
        <div className="flex justify-between pt-6 border-t mt-6">
          {onBack && !isFirstStep ? (
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
          ) : (
            <div />
          )}
          {onNext && (
            <Button onClick={onNext} disabled={nextDisabled}>
              {isLastStep ? (nextLabel ?? "Submit") : (nextLabel ?? "Next")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
