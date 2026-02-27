"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Briefcase, Plus, Share2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { fetchJobs, deleteJob } from "@/lib/api";
import { hasRunningJobs } from "@/lib/utils";
import { getJobColumns } from "@/components/columns/job-columns";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/empty-state";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Job } from "@/lib/types";

export default function JobsPage() {
  const router = useRouter();

  const { data: jobs, mutate } = useSWR("jobs", fetchJobs, {
    refreshInterval: (data) => (hasRunningJobs(data) ? 2000 : 0),
  });

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteJob(id);
      toast.success("Job deleted");
      mutate();
    },
    [mutate],
  );

  const columns = useMemo(
    () => getJobColumns({ onDelete: handleDelete }),
    [handleDelete],
  );

  const handleRowClick = useCallback(
    (job: Job) => {
      if (job.status === "draft") {
        router.push(`/jobs/new?draft=${job.id}`);
      } else {
        router.push(`/jobs/${job.id}`);
      }
    },
    [router],
  );

  return (
    <Tabs defaultValue="jobs">
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="jobs" className="gap-1.5">
            <Briefcase size={14} />
            Jobs
          </TabsTrigger>

          <TabsTrigger value="graph" className="gap-1.5">
            <Share2 size={14} />
            Graph
          </TabsTrigger>
        </TabsList>
        <Button asChild size="sm">
          <Link href="/jobs/new">
            <Plus size={14} className="mr-1" />
            Create job
          </Link>
        </Button>
      </div>

        <TabsContent value="jobs">
          {!jobs?.length ? (
            <EmptyState
              icon={Briefcase}
              title="No jobs yet"
              description="Jobs let you process and transform your data assets."
              actionHref="/jobs/new"
              actionLabel="Create job"
            />
          ) : (
            <DataTable
              columns={columns}
              data={jobs}
              searchKey="name"
              searchPlaceholder="Search jobs..."
              onRowClick={handleRowClick}
            />
          )}
        </TabsContent>

        <TabsContent value="graph">
          <KnowledgeGraph />
        </TabsContent>
    </Tabs>
  );
}
