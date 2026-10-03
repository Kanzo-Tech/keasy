"use client";

import { useParams } from "next/navigation";
import { SectionBody, SectionRoot, Skeleton } from "@kanzo-tech/ui";
import { Boundary, Loading } from "@/components/boundary";
import { GraphHeader } from "./_parts/graph-header";

/**
 * A graph's one home: a header that is always there — its name, its status, one primary action and
 * the rest in a menu — over routed tabs (Overview · Recipe · Explore).
 */
export default function GraphLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
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
