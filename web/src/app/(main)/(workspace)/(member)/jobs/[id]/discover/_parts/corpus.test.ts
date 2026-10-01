import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { toProblem } from "@/lib/errors";

const notFound = new ApiError({ code: "job/not-found", title: "Not found", detail: "No such job", data: {} }, 404);

vi.mock("@kanzo-tech/ui/analytics", () => ({ engine: async () => ({ coordinator: {} }), MosaicProvider: () => null }));
vi.mock("@/lib/api/query-client", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return { queryClient: new QueryClient() };
});
vi.mock("@/lib/fossil/corpus", () => ({
  corpusKey: (jobId: string) => ["corpus", jobId] as const,
  openJobCorpus: async () => {
    throw notFound;
  },
}));

const { corpusQuery } = await import("./corpus");

describe("corpusQuery", () => {
  it("settles on the error a failed open raises, so the page shows it instead of a spinner", async () => {
    const observer = new QueryObserver(new QueryClient(), corpusQuery("00000000-0000-0000-0000-000000000000"));
    const settled = new Promise<ReturnType<typeof observer.getCurrentResult>>((resolve) => {
      const stop = observer.subscribe((result) => {
        if (result.status !== "pending") {
          stop();
          resolve(result);
        }
      });
    });
    const result = await settled;
    expect(result.status).toBe("error");
    expect(toProblem(result.error).code).toBe("job/not-found");
  });
});
