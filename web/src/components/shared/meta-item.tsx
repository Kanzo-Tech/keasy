import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@kanzo-tech/ui";

export function MetaItem({
  label,
  value,
  mono,
  capitalize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <Tooltip positioning={{ placement: "bottom" }}>
        <TooltipTrigger asChild>
          <p
            className={cn("text-sm truncate", mono && "font-mono", capitalize && "capitalize")}
          >
            {value}
          </p>
        </TooltipTrigger>
        <TooltipContent className="max-w-md break-all font-mono text-xs">
          {value}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
