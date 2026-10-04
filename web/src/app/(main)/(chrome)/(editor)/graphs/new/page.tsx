import { Suspense } from "react";
import { GraphStudioPage } from "./_parts/graph-studio";

export default function NewGraphPage() {
  return (
    <Suspense>
      <GraphStudioPage />
    </Suspense>
  );
}
