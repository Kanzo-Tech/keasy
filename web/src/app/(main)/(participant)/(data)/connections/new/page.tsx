import { Suspense } from "react";
import { ConnectionEditor } from "@/components/connection-editor";

export default function NewConnectionPage() {
  return (
    <Suspense>
      <ConnectionEditor />
    </Suspense>
  );
}
