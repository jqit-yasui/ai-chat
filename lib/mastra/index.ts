import { Mastra } from "@mastra/core/mastra";
import { chatAgent } from "@/lib/mastra/agents/chat-agent";

export const mastra = new Mastra({
  agents: { chatAgent },
});
