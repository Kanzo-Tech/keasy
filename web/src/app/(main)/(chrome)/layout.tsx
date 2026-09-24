import { ShellMain } from "@kanzo-tech/ui";

export default function ChromeLayout({ children }: { children: React.ReactNode }) {
  // The page's single `<main>`; everything nested under it is a `<section>`.
  return <ShellMain className="overflow-hidden">{children}</ShellMain>;
}
