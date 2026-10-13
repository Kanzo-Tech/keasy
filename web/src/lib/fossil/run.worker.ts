// The worker a run happens in — a graph's, or the assistant's preview: fossil's executor, booted
// here, over the page's host (`run-worker.ts` is the protocol and the argument, `executor.ts` the door).
import { runInto } from "./executor";
import { serveRun, type Port } from "./run-worker";

serveRun(self as unknown as Port, runInto);
