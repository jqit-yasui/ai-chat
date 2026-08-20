import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateChatReply } from "@/lib/mastra/agents/chat-agent";
import type { AppEnv } from "@/lib/hono/types";
import {
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_BYTES,
  isAllowedImageMimeType,
  parseImageDataUrl,
} from "@/lib/image-constraints";

const imageSchema = z.string().refine((value) => {
  const parsed = parseImageDataUrl(value);
  if (!parsed) return false;
  if (!isAllowedImageMimeType(parsed.mimeType)) return false;
  return parsed.approxBytes <= MAX_IMAGE_BYTES;
}, "画像の形式（jpg/png/webp/gif）またはサイズ（4MB以内）が不正です。");

const chatRequestSchema = z
  .object({
    message: z.string().trim().max(4000, "メッセージは4000文字以内で入力してください。").default(""),
    images: z
      .array(imageSchema)
      .max(MAX_IMAGES_PER_MESSAGE, `画像は${MAX_IMAGES_PER_MESSAGE}枚まで添付できます。`)
      .default([]),
  })
  .refine((data) => data.message.length > 0 || data.images.length > 0, {
    message: "メッセージまたは画像を入力してください。",
  });

const LLM_TIMEOUT_MS = 30_000;

export const chatRoute = new Hono<AppEnv>().post(
  "/chat",
  zValidator("json", chatRequestSchema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "メッセージの形式が正しくありません。";
      return c.json({ error: message }, 400);
    }
  }),
  async (c) => {
    const { message, images } = c.req.valid("json");
    const dbSessionId = c.get("dbSessionId");

    let userMessage;
    try {
      userMessage = await prisma.message.create({
        data: { sessionId: dbSessionId, role: "user", content: message, images },
      });
    } catch (error) {
      console.error("Failed to save user message:", error);
      return c.json(
        { error: "メッセージの保存に失敗しました。しばらく時間をおいて再度お試しください。" },
        500,
      );
    }

    let assistantText: string;
    const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUT_MS);
    try {
      const result = await generateChatReply(message, images, { abortSignal: timeoutSignal });
      assistantText = result.text;
    } catch (error) {
      if (timeoutSignal.aborted) {
        console.error("LLM API timeout:", error);
        return c.json(
          { error: "AIの応答がタイムアウトしました。しばらく時間をおいて再度お試しください。" },
          504,
        );
      }
      console.error("LLM API error:", error);
      return c.json(
        { error: "AIの応答生成に失敗しました。しばらく時間をおいて再度お試しください。" },
        502,
      );
    }

    if (!assistantText || assistantText.trim().length === 0) {
      // generateChatReply は空応答を検知すると次候補へフォールバックし、
      // 全モデルが空応答（または失敗）だった場合は例外を投げる想定のため
      // 通常はここに到達しないが、念のため空文字のまま保存しない防御を入れる。
      console.error("LLM API returned an empty response after all fallbacks.");
      return c.json(
        { error: "AIの応答生成に失敗しました。しばらく時間をおいて再度お試しください。" },
        502,
      );
    }

    let assistantMessage;
    try {
      assistantMessage = await prisma.message.create({
        data: { sessionId: dbSessionId, role: "assistant", content: assistantText },
      });
    } catch (error) {
      console.error("Failed to save assistant message:", error);
      return c.json(
        { error: "応答の保存に失敗しました。しばらく時間をおいて再度お試しください。" },
        500,
      );
    }

    return c.json({ userMessage, assistantMessage });
  },
);
