import { cn } from "@/lib/utils"

interface SkeletonProps extends React.ComponentProps<"div"> {
  /** When true with children, shows skeleton overlay preserving children's dimensions. */
  loading?: boolean;
  children?: React.ReactNode;
}

function Skeleton({ className, loading, children, ...props }: SkeletonProps) {
  // Classic mode: bare placeholder (backwards compatible)
  if (children === undefined) {
    return (
      <div
        data-slot="skeleton"
        className={cn("bg-accent animate-pulse rounded-md", className)}
        {...props}
      />
    )
  }

  // Wrap mode: not loading → render children directly
  if (!loading) return <>{children}</>

  // Wrap mode: loading → invisible children (for sizing) + skeleton overlay
  return (
    <span
      data-slot="skeleton"
      className={cn("relative inline-flex", className)}
      aria-hidden
      {...props}
    >
      <span className="invisible">{children}</span>
      <span className="absolute inset-0 bg-accent animate-pulse rounded-md" />
    </span>
  )
}

export { Skeleton }
export type { SkeletonProps }
