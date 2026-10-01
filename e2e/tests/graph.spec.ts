import { test } from "@playwright/test";

test.fixme("24 a browser without WebGL shows graph/no-webgl in the canvas", async () => {
  // waits on kanzo-ui 0.17: the graph's onFailure passes a string today; with the thrown value and
  // kanzo-ui's code, this runs with --disable-webgl and asserts graph/no-webgl.
});
