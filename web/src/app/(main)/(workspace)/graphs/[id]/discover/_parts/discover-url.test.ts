import { describe, expect, it } from "vitest";
import { readDiscoverState, writeDiscoverState, type DiscoverState } from "./discover-url";

const read = (query: string) => readDiscoverState(new URLSearchParams(query));
const write = (query: string, state: DiscoverState) => writeDiscoverState(new URLSearchParams(query), state).toString();

describe("Discovery's URL", () => {
  it("opens bare on the Graph view with Info in the dock, as the page always has", () => {
    expect(read("")).toEqual({ view: "graph", panel: "info" });
  });

  it("opens a dashboard with the dock collapsed unless it names a panel", () => {
    expect(read("view=dashboard")).toEqual({ view: "dashboard", panel: "none" });
    expect(read("view=dashboard&panel=rules")).toEqual({ view: "dashboard", panel: "rules" });
  });

  it("names a collapsed dock beside the graph as none", () => {
    expect(read("panel=none")).toEqual({ view: "graph", panel: "none" });
  });

  it("reads a value it does not know as absent", () => {
    expect(read("view=table&panel=chat")).toEqual({ view: "graph", panel: "info" });
    expect(read("view=dashboard&panel=Rules")).toEqual({ view: "dashboard", panel: "none" });
  });

  it("carries only what differs from the view's default", () => {
    expect(write("", { view: "graph", panel: "info" })).toBe("");
    expect(write("", { view: "graph", panel: "none" })).toBe("panel=none");
    expect(write("", { view: "dashboard", panel: "none" })).toBe("view=dashboard");
    expect(write("", { view: "dashboard", panel: "ask" })).toBe("view=dashboard&panel=ask");
    expect(write("view=dashboard&panel=rules", { view: "graph", panel: "info" })).toBe("");
  });

  it("keeps every other parameter", () => {
    expect(write("tab=2&panel=info", { view: "graph", panel: "settings" })).toBe("tab=2&panel=settings");
  });

  it("reads back what it wrote", () => {
    for (const view of ["graph", "dashboard"] as const) {
      for (const panel of ["info", "ask", "rules", "settings", "none"] as const) {
        expect(read(write("", { view, panel }))).toEqual({ view, panel });
      }
    }
  });
});
