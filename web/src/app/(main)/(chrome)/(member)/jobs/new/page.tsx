import { Suspense } from "react";
import { JobStudio } from "./_parts/job-studio";

export default function NewJobPage() {
  return (
    <Suspense>
      <JobStudio />
    </Suspense>
  );
}
