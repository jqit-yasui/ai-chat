import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { streamChatReply } from "@/lib/mastra/agents/chat-agent";
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

    const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUT_MS);
    let streamResult: Awaited<ReturnType<typeof streamChatReply>>;
    try {
      // ここでは最初の意味のあるチャンクを受け取れるかどうかまでを待つ
      // （フォールバック判定に必要なため）。ストリーミングはこの後の
      // streamSSE 内で行う。
      streamResult = await streamChatReply(message, images, { abortSignal: timeoutSignal });
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

    return streamSSE(c, async (sseStream) => {
      let assistantText = "";
      try {
        for await (const chunk of streamResult.stream) {
          assistantText += chunk;
          await sseStream.writeSSE({ event: "chunk", data: JSON.stringify({ text: chunk }) });
        }
      } catch (error) {
        console.error(
          timeoutSignal.aborted ? "LLM API timeout during streaming:" : "LLM API error during streaming:",
          error,
        );
      }

      if (!assistantText || assistantText.trim().length === 0) {
        console.error("LLM API returned an empty response while streaming.");
        await sseStream.writeSSE({
          event: "error",
          data: JSON.stringify({
            error: timeoutSignal.aborted
              ? "AIの応答がタイムアウトしました。しばらく時間をおいて再度お試しください。"
              : "AIの応答生成に失敗しました。しばらく時間をおいて再度お試しください。",
          }),
        });
        return;
      }

      // 保存するMessageレコードは、ストリーム完了後の最終テキストのみ
      // （途中経過は保存しない）。
      let assistantMessage;
      try {
        assistantMessage = await prisma.message.create({
          data: { sessionId: dbSessionId, role: "assistant", content: assistantText },
        });
      } catch (error) {
        console.error("Failed to save assistant message:", error);
        await sseStream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: "応答の保存に失敗しました。しばらく時間をおいて再度お試しください。" }),
        });
        return;
      }

      await sseStream.writeSSE({
        event: "done",
        data: JSON.stringify({ userMessage, assistantMessage }),
      });
    });
  },
);
