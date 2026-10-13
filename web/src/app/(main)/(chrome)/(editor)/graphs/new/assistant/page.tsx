import { AssistantPage } from "../_parts/assistant/assistant-flow";

/**
 * The assistant's guided chat (docs/design/assistant.md), beside the wizard it replaces: the
 * mode picker still opens the five-screen wizard, and this segment is reached by its URL until the
 * Tasks behind it are built and it takes the wizard's place.
 */
export default function NewGraphAssistantPage() {
  return <AssistantPage />;
}
