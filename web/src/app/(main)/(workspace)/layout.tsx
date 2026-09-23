import { ShellMain } from "@kanzo-tech/ui";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <ShellMain className="overflow-hidden">{children}</ShellMain>;
}
