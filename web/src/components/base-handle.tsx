import type { ComponentProps } from "react";
import { Handle, type HandleProps } from "@xyflow/react";

import { cn } from "@/lib/utils";

export type BaseHandleProps = HandleProps;

export function BaseHandle({
  className,
  style,
  children,
  ...props
}: ComponentProps<typeof Handle>) {
  return (
    <Handle
      {...props}
      className={cn("rounded-full transition", className)}
      style={{
        width: 11,
        height: 11,
        background: "var(--color-secondary)",
        borderWidth: 1,
        borderColor: "var(--color-border)",
        ...style,
      }}
    >
      {children}
    </Handle>
  );
}
