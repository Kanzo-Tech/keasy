import { Suspense } from "react";
import { JobStudio } from "@/components/jobs/job-studio";

export default function NewJobPage() {
  return (
    <Suspense>
      <JobStudio />
    </Suspense>
  );
}
