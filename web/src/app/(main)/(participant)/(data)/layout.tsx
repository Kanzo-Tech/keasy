export default function DataLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex flex-col h-full p-4 gap-4">{children}</div>;
}
