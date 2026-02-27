"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardStepDef {
  id: string;
  label: string;
  description?: string;
}

type StepStatus = "completed" | "current" | "pending";

interface WizardStepperProps {
  steps: WizardStepDef[];
  currentStep: number;
  onStepClick: (step: number) => void;
}

function getStepStatus(index: number, currentStep: number): StepStatus {
  if (index < currentStep) return "completed";
  if (index === currentStep) return "current";
  return "pending";
}

export function WizardStepper({ steps, currentStep, onStepClick }: WizardStepperProps) {
  return (
    <nav aria-label="Wizard steps">
      <ol className="space-y-1">
        {steps.map((step, index) => {
          const status = getStepStatus(index, currentStep);
          const isCompleted = status === "completed";
          const isCurrent = status === "current";
          const isPending = status === "pending";

          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => isCompleted && onStepClick(index)}
                disabled={isPending}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  isCompleted && "hover:bg-accent cursor-pointer",
                  isCurrent && "bg-accent cursor-default",
                  isPending && "cursor-not-allowed opacity-60"
                )}
              >
                {/* Step icon */}
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium",
                    isCompleted && "border-emerald-600 bg-emerald-600 text-white",
                    isCurrent && "border-primary bg-primary text-primary-foreground",
                    isPending && "border-muted-foreground bg-transparent text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </span>

                {/* Step label */}
                <span className="flex flex-col min-w-0">
                  <span
                    className={cn(
                      "text-sm font-medium leading-tight",
                      isPending && "text-muted-foreground font-normal"
                    )}
                  >
                    {step.label}
                  </span>
                  {step.description && (
                    <span className="text-xs text-muted-foreground mt-0.5 leading-tight">
                      {step.description}
                    </span>
                  )}
                </span>
              </button>

              {/* Connector line between steps */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "ml-[1.625rem] my-0.5 w-px h-3",
                    isCompleted ? "bg-emerald-600" : "bg-border"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
