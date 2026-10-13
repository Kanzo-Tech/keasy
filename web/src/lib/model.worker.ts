// The worker the model runs in: WebLLM's engine, off the page's thread (`ai.ts` starts it).
import { serveLocalModel } from "@kanzo-tech/llm/local";

void serveLocalModel();
