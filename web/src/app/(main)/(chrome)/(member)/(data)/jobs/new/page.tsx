import { Suspense } from "react";
import { JobEditor } from "@/components/jobs/job-editor";

export default function NewJobPage() {
  return (
    <Suspense>
      <JobEditor />
    </Suspense>
  );
}
