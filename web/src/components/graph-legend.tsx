export function GraphLegend({ extra }: { extra?: React.ReactNode }) {
  if (!extra) return null;
  return (
    <div className="flex items-center px-3 py-2 border-b border-border">
      <span className="ml-auto text-xs text-muted-foreground">{extra}</span>
    </div>
  );
}
