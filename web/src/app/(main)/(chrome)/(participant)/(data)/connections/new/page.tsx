import { PageShell } from "@/components/layout/page-shell";
import { ConnectionEditor } from "@/components/connections/connection-editor";

export default function NewConnectionPage() {
  return (
    <PageShell>
      <ConnectionEditor />
    </PageShell>
  );
}
