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

// 無料モデルの中には画像入力（vision）に対応していないものがある。
// 429と同様、そのエラーを検知した場合も次の候補モデルへフォールバックする。
// どのモデルが実際に vision 対応かは OpenRouter 側の実地検証が必要なため、
// 事前にモデルを決め打ちせずエラー内容から判定する方式にしている。
function isUnsupportedImageError(error: unknown, hasImages: boolean): boolean {
  if (!hasImages) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /image|vision|modalit|multimodal|unsupported/i.test(message);
}

export interface GenerateChatReplyOptions {
  abortSignal?: AbortSignal;
}

export interface GenerateChatReplyResult {
  text: string;
  modelId: string;
}

type UserContentPart = { type: "text"; text: string } | { type: "image"; image: string };

function buildUserMessage(message: string, images: string[]) {
  if (images.length === 0) {
    return message;
  }

  const content: UserContentPart[] = [];
  if (message) {
    content.push({ type: "text", text: message });
  }
  for (const image of images) {
    content.push({ type: "image", image });
  }

  return [{ role: "user" as const, content }];
}

/**
 * FALLBACK_MODEL_IDS を先頭から順に試し、429（レート制限）や画像入力
 * 非対応エラーを検知したら次の候補モデルへ自動フォールバックする。
 */
export async function generateChatReply(
  message: string,
  images: string[] = [],
  options: GenerateChatReplyOptions = {},
): Promise<GenerateChatReplyResult> {
  let lastError: unknown;
  const input = buildUserMessage(message, images);

  for (let i = 0; i < FALLBACK_MODEL_IDS.length; i++) {
    const modelId = FALLBACK_MODEL_IDS[i];
    const agent = i === 0 ? chatAgent : new Agent({
      id: "chat-agent",
      name: "Chat Agent",
      instructions: INSTRUCTIONS,
      model: openrouter(modelId),
    });

    try {
      const result = await agent.generate(input, options);
      return { text: result.text, modelId };
    } catch (error) {
      lastError = error;
      const isLastCandidate = i === FALLBACK_MODEL_IDS.length - 1;
      if (
        (isRateLimitError(error) || isUnsupportedImageError(error, images.length > 0)) &&
        !isLastCandidate
      ) {
        console.warn(
          `OpenRouterモデル "${modelId}" が利用できなかったため（レート制限または画像非対応の可能性）、次の候補モデルにフォールバックします。`,
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
