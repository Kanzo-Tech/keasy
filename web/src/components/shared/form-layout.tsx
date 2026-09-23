import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldRequiredIndicator,
} from "@kanzo-tech/ui";

/**
 * Keasy's shorthand over the design system's `Field` parts — the same label-over-control
 * row, written once instead of at each of the twenty call sites. `Field` generates the id
 * and connects the label to the control, so nothing here does markup of its own.
 */
export function FormField({
  label,
  description,
  required,
  optional,
  className,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Field className={className} required={required}>
      <FieldLabel>
        {label}
        {required && <FieldRequiredIndicator />}
        {optional && <span className="text-muted-foreground text-xs"> (optional)</span>}
      </FieldLabel>
      {description && <FieldDescription>{description}</FieldDescription>}
      {children}
    </Field>
  );
}
