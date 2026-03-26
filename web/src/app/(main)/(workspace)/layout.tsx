export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-hidden flex flex-col">{children}</div>;
}
