import { use } from "react";

import { PageShell } from "@/components/layout/page-shell";
import { ConnectionEditFlow } from "@/components/connections/connection-edit-flow";

export default function EditConnectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <PageShell>
      <ConnectionEditFlow id={id} />
    </PageShell>
  );
}
