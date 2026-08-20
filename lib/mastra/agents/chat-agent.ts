import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const INSTRUCTIONS =
  "あなたは親切な汎用AIアシスタントです。ユーザーの質問や相談に、常に日本語で分かりやすく丁寧に回答してください。";

// OpenRouter の無料モデルは共有プールのレート制限（429）に当たることがあるため、
// 優先度順に並べた候補から順にフォールバックする。
export const FALLBACK_MODEL_IDS = [
  "openai/gpt-oss-20b:free",
  "z-ai/glm-5.2:free",
  "google/gemma-4-31b-it:free",
] as const;

export const chatAgent = new Agent({
  id: "chat-agent",
  name: "Chat Agent",
  instructions: INSTRUCTIONS,
  model: openrouter(FALLBACK_MODEL_IDS[0]),
});

function isRateLimitError(error: unknown): boolean {
  const withStatus = error as {
    statusCode?: number;
    status?: number;
    response?: { status?: number };
    cause?: unknown;
  };
  const status =
    withStatus?.statusCode ?? withStatus?.status ?? withStatus?.response?.status;
  if (status === 429) return true;
  if (withStatus?.cause) return isRateLimitError(withStatus.cause);

  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b/.test(message) || /rate.?limit/i.test(message);
}

export interface GenerateChatReplyOptions {
  abortSignal?: AbortSignal;
}

export interface GenerateChatReplyResult {
  text: string;
  modelId: string;
}

/**
 * FALLBACK_MODEL_IDS を先頭から順に試し、429（レート制限）を検知したら
 * 次の候補モデルへ自動フォールバックする。
 */
export async function generateChatReply(
  message: string,
  options: GenerateChatReplyOptions = {},
): Promise<GenerateChatReplyResult> {
  let lastError: unknown;

  for (let i = 0; i < FALLBACK_MODEL_IDS.length; i++) {
    const modelId = FALLBACK_MODEL_IDS[i];
    const agent = i === 0 ? chatAgent : new Agent({
      id: "chat-agent",
      name: "Chat Agent",
      instructions: INSTRUCTIONS,
      model: openrouter(modelId),
    });

    try {
      const result = await agent.generate(message, options);
      return { text: result.text, modelId };
    } catch (error) {
      lastError = error;
      const isLastCandidate = i === FALLBACK_MODEL_IDS.length - 1;
      if (isRateLimitError(error) && !isLastCandidate) {
        console.warn(
          `OpenRouterモデル "${modelId}" がレート制限(429)を返したため、次の候補モデルにフォールバックします。`,
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
