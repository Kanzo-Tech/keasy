import { describe, expect, it } from "vitest";
import { layoutSchema } from "./schema-layout";

describe("layoutSchema", () => {
  it("routes every edge table on its own line, a self-relation included", async () => {
    const laid = await layoutSchema(
      [
        { name: "Person", rows: 3 },
        { name: "Post", rows: 2 },
      ],
      [
        { name: "Post_hasCreator_Person", rows: 2, source: "Post", destination: "Person" },
        { name: "Post_likedBy_Person", rows: 1, source: "Post", destination: "Person" },
        { name: "Person_knows_Person", rows: 4, source: "Person", destination: "Person" },
      ],
    );
    const [person, post] = laid.nodes;
    // Left to right: what an edge leaves sits before what it reaches.
    expect(post.x).toBeLessThan(person.x);
    for (const edge of laid.edges) expect(edge.route.length).toBeGreaterThanOrEqual(2);
    const [creator, liked] = laid.edges;
    expect(creator.route).not.toEqual(liked.route);
  });
});
