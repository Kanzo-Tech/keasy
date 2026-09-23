import { cn, ShellAside, ShellBody } from "@kanzo-tech/ui";

/**
 * A page-level nav column beside its pane — settings, and nothing else so far. The regions
 * are the design system's: `ShellAside` renders the `<aside>` complementary landmark and
 * carries the divider, `ShellBody` is the band the two sit in.
 *
 * The width stays a class rather than `ShellAside`'s `width` prop, which is px: this column
 * is a fraction of the pane with a floor and a ceiling.
 */
export function SidebarContentLayout({
  nav,
  children,
  asideClassName,
}: {
  nav: React.ReactNode;
  children: React.ReactNode;
  asideClassName?: string;
}) {
  return (
    <ShellBody className="h-full w-full overflow-hidden">
      <ShellAside
        aria-label="Section"
        className={cn("w-1/5 min-w-50 max-w-62.5 overflow-auto", asideClassName)}
      >
        {nav}
      </ShellAside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </ShellBody>
  );
}
