import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const placements = {
  inline: "top-1/2 -translate-y-1/2 right-1.5",
  absolute: "top-0 right-0 -translate-y-2/3 translate-x-1/2",
} as const;

type Placement = keyof typeof placements;

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
    <div className={cn("relative", className)}>
      <div className="pointer-events-none opacity-50">{children}</div>
      <Badge
        className={cn(
          "text-[10px] px-1.5 py-0 h-5 shrink-0 absolute",
          placements[placement],
        )}
      >
        Coming soon
      </Badge>
    </div>
  );
}
