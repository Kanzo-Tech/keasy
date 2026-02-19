import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FormLayout({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}

export function FormField({
  label,
  description,
  required,
  optional,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required && <span className="text-red-400"> *</span>}
        {optional && <span className="text-muted-foreground text-xs"> (optional)</span>}
      </Label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}

export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between pt-2">{children}</div>;
}
