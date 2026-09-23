import { Badge, cn } from "@kanzo-tech/ui";

const placements = {
  inline: "top-1/2 -translate-y-1/2 end-1.5",
  absolute: "top-0 end-0 -translate-y-2/3 translate-x-1/2",
} as const;

type Placement = keyof typeof placements;

/**
 * A gated control: visible, dimmed and unreachable, with a badge saying why.
 *
 * Both wrappers are `h-full` because the thing gated is usually one cell of a grid the
 * design system laid out — a `RadioGroup columns={2}` — and a wrapper that sized to its
 * content would leave the disabled card shorter than the one beside it.
 */
export function ComingSoon({
  children,
  className,
  placement = "absolute",
}: {
  children: React.ReactNode;
  className?: string;
  placement?: Placement;
}) {
  return (
    <div className={cn("relative h-full", className)}>
      <div className="pointer-events-none h-full opacity-50">{children}</div>
      <Badge
        className={cn("absolute h-5 shrink-0 px-1.5 py-0 text-[10px]", placements[placement])}
      >
        Coming soon
      </Badge>
    </div>
  );
}
