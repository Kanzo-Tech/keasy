import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ExperimentalBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] px-1.5 py-0 h-5 gap-1", className)}
    >
      <FlaskConical size={10} />
      Experimental
    </Badge>
  );
}
