// The worker a graph run happens in: fossil's executor, booted here, over the page's host
// (`run-worker.ts` is the protocol and the argument).
import { run } from "@fossil-lang/executor";

import { serveRun, type Port } from "./run-worker";

serveRun(self as unknown as Port, (program, options) => run(program, options));
