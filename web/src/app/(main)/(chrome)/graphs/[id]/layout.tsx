"use client";

import { useParams } from "next/navigation";
import { SectionBody, SectionRoot, Skeleton } from "@kanzo-tech/ui";
import { Boundary, Loading } from "@/components/boundary";
import { usePreloadModel } from "@/lib/ai";
import { GraphHeader } from "./_parts/graph-header";

/**
 * A graph's one home: a header that is always there — its name, its status, one primary action and
 * the rest in a menu — over the graph's page. Opening it starts the model's download in the
 * background: a graph is what a person asks about.
 */
export default function GraphLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  usePreloadModel();
  return (
    <SectionRoot>
      <Boundary
        fallback={
          <Loading>
            <SectionBody scale="page">
              <Skeleton className="h-12 w-full" />
            </SectionBody>
          </Loading>
        }
      >
        <GraphHeader id={id} />
        <SectionBody scale="page">
          <Boundary
            fallback={
              <Loading>
                <Skeleton className="h-40 w-full" />
              </Loading>
            }
          >
            {children}
          </Boundary>
        </SectionBody>
      </Boundary>
    </SectionRoot>
  );
}
