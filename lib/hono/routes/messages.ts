import { Hono } from "hono";
import { prisma } from "@/lib/prisma";
import type { AppEnv } from "@/lib/hono/types";

export const messagesRoute = new Hono<AppEnv>().get("/messages", async (c) => {
  const dbSessionId = c.get("dbSessionId");

  try {
    const messages = await prisma.message.findMany({
      where: { sessionId: dbSessionId },
      orderBy: { createdAt: "asc" },
    });
    return c.json({ messages });
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    return c.json({ error: "会話履歴の取得に失敗しました。しばらく時間をおいて再度お試しください。" }, 500);
  }
});
