import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { mastra } from "@/lib/mastra";
import type { AppEnv } from "@/lib/hono/types";

const chatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "メッセージを入力してください。")
    .max(4000, "メッセージは4000文字以内で入力してください。"),
});

const LLM_TIMEOUT_MS = 30_000;

export const chatRoute = new Hono<AppEnv>().post(
  "/chat",
  zValidator("json", chatRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "メッセージの形式が正しくありません。" }, 400);
    }
  }),
  async (c) => {
    const { message } = c.req.valid("json");
    const dbSessionId = c.get("dbSessionId");

    let userMessage;
    try {
      userMessage = await prisma.message.create({
        data: { sessionId: dbSessionId, role: "user", content: message },
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
      const agent = mastra.getAgentById("chat-agent");
      const result = await agent.generate(message, { abortSignal: timeoutSignal });
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
