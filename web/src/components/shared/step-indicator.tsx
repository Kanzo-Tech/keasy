import {
  Steps,
  StepsIndicator,
  StepsItem,
  StepsList,
  StepsSeparator,
  StepsTitle,
  StepsTrigger,
} from "@kanzo-tech/ui";

interface StepIndicatorProps {
  steps: readonly string[];
  current: number;
}

/**
 * The wizard's progress, read-only: `step` is controlled and no `onStepChange` is wired, so
 * the row reports where the wizard is rather than offering to move it. The wizard owns that.
 */
export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <Steps count={steps.length} step={current}>
      <StepsList>
        {steps.map((label, index) => (
          <StepsItem index={index} key={label}>
            <StepsTrigger disabled>
              <StepsIndicator>{index + 1}</StepsIndicator>
              <StepsTitle className="hidden sm:inline">{label}</StepsTitle>
            </StepsTrigger>
            <StepsSeparator />
          </StepsItem>
        ))}
      </StepsList>
    </Steps>
  );
}
