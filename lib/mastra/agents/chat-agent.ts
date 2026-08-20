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

// 画像添付時に使う候補リスト。OpenRouter のモデル一覧API
// （GET https://openrouter.ai/api/v1/models）で architecture.input_modalities
// に "image" を含む :free モデルを調査して選定（2026-08-20時点で確認）。
// FALLBACK_MODEL_IDS のうち画像入力に対応しているのは google/gemma-4-31b-it:free
// のみで、他の2つは "No endpoints found that support image input" で必ず失敗するため、
// 画像添付時はこちらの vision 対応モデルのみのリストを使う。
export const VISION_FALLBACK_MODEL_IDS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
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

// 画像複数枚の添付などで入力トークンが上限を超えた場合、モデルが
// エラーを返さず空文字列の応答を返すことがある（HTTP 200 のまま）。
// これを成功として扱うとフォールバックがすり抜けてしまうため、
// 空応答は専用のエラーとして扱い、429や画像非対応エラーと同様に
// 次の候補モデルへフォールバックする。
class EmptyResponseError extends Error {
  constructor(modelId: string) {
    super(`OpenRouterモデル "${modelId}" が空の応答を返しました。`);
    this.name = "EmptyResponseError";
  }
}

function isEmptyResponseError(error: unknown): boolean {
  return error instanceof EmptyResponseError;
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
 * 画像添付の有無に応じて FALLBACK_MODEL_IDS / VISION_FALLBACK_MODEL_IDS を
 * 先頭から順に試し、429（レート制限）や画像入力非対応エラーを検知したら
 * 次の候補モデルへ自動フォールバックする。
 */
export async function generateChatReply(
  message: string,
  images: string[] = [],
  options: GenerateChatReplyOptions = {},
): Promise<GenerateChatReplyResult> {
  const hasImages = images.length > 0;
  const modelIds: readonly string[] = hasImages ? VISION_FALLBACK_MODEL_IDS : FALLBACK_MODEL_IDS;
  const input = buildUserMessage(message, images);
  let lastError: unknown;

  for (let i = 0; i < modelIds.length; i++) {
    const modelId = modelIds[i];
    const agent =
      i === 0 && modelId === FALLBACK_MODEL_IDS[0]
        ? chatAgent
        : new Agent({
            id: "chat-agent",
            name: "Chat Agent",
            instructions: INSTRUCTIONS,
            model: openrouter(modelId),
          });

    try {
      const result = await agent.generate(input, options);
      if (!result.text || result.text.trim().length === 0) {
        throw new EmptyResponseError(modelId);
      }
      return { text: result.text, modelId };
    } catch (error) {
      lastError = error;
      const isLastCandidate = i === modelIds.length - 1;
      const isEmpty = isEmptyResponseError(error);
      if (
        (isRateLimitError(error) || isUnsupportedImageError(error, hasImages) || isEmpty) &&
        !isLastCandidate
      ) {
        console.warn(
          isEmpty
            ? `OpenRouterモデル "${modelId}" が空の応答を返したため、次の候補モデルにフォールバックします。`
            : `OpenRouterモデル "${modelId}" が利用できなかったため（レート制限または画像非対応の可能性）、次の候補モデルにフォールバックします。`,
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
