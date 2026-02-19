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
      <p
        className={`text-sm truncate ${mono ? "font-mono" : ""} ${capitalize ? "capitalize" : ""}`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
