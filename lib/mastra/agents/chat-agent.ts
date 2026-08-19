import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const chatAgent = new Agent({
  id: "chat-agent",
  name: "Chat Agent",
  instructions:
    "あなたは親切な汎用AIアシスタントです。ユーザーの質問や相談に、常に日本語で分かりやすく丁寧に回答してください。",
  model: openrouter("openai/gpt-oss-20b:free"),
});
