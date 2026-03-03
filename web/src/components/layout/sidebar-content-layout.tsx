export function SidebarContentLayout({
  nav,
  children,
}: {
  nav: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full gap-4 overflow-auto p-4">
      <aside className="w-1/5 min-w-50 max-w-62.5">{nav}</aside>
      <div className="flex-1 min-w-0">
        <div className="max-w-3xl mx-auto pb-4">{children}</div>
      </div>
    </div>
  );
}
