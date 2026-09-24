import { SectionRoot } from "@kanzo-tech/ui";
import { JobDetailView } from "@/components/jobs/job-detail-view";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SectionRoot>
      <JobDetailView id={id} />
    </SectionRoot>
  );
}
