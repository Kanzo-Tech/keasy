import { test } from "../support/fixtures";
import { expectProblem } from "../support/problem";

// A browser with no WebGL at all: the graph fails in its canvas, by its code.
test.use({ launchOptions: { args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"] } });

test("24 a browser without WebGL shows graph/no-webgl in the canvas", async ({ page, corpusJob }) => {
  await page.goto(`/jobs/${corpusJob}/discover`);
  await expectProblem(page, "graph/no-webgl", { within: 20_000 });
});
