import { PageContent } from "@/components/layout/page-content";

export default function DataLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PageContent className="flex flex-col gap-4 overflow-hidden">{children}</PageContent>;
}
