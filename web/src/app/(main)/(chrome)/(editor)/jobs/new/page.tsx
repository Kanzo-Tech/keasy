import { Suspense } from "react";
import { JobStudioPage } from "./_parts/job-studio";

export default function NewJobPage() {
  return (
    <Suspense>
      <JobStudioPage />
    </Suspense>
  );
}
