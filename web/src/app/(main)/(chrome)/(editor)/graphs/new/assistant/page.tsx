import { AssistantPage } from "../_parts/assistant/assistant-flow";

/**
 * The assistant's three screens (docs/design/assistant.md), beside the wizard they replace: the
 * mode picker still opens the five-screen wizard, and this segment is reached by its URL until the
 * Tasks behind it are built and it takes the wizard's place.
 */
export default function NewGraphAssistantPage() {
  return <AssistantPage />;
}
