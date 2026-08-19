import { randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppEnv } from "@/lib/hono/types";

export const SESSION_COOKIE_NAME = "session_id";
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1年

export async function sessionMiddleware(c: Context<AppEnv>, next: Next) {
  let sessionId = getCookie(c, SESSION_COOKIE_NAME);

  if (!sessionId) {
    sessionId = randomUUID();
    setCookie(c, SESSION_COOKIE_NAME, sessionId, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
  }

  const session = await findOrCreateSession(sessionId);

  c.set("sessionId", session.sessionId);
  c.set("dbSessionId", session.id);

  await next();
}

// upsert() は MongoDB 上で更新系オペレーションとして実行され、Atlas M0（トランザクション
// 非対応）では失敗することがあるため、findUnique → 存在しなければ create という
// トランザクションを使わない実装にしている。ごく稀に同一 sessionId で create が競合した
// 場合は一意制約エラー（P2002）を捕捉し、再度 findUnique で取得し直す。
async function findOrCreateSession(sessionId: string) {
  const existing = await prisma.session.findUnique({ where: { sessionId } });
  if (existing) {
    return existing;
  }

  try {
    return await prisma.session.create({ data: { sessionId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const session = await prisma.session.findUnique({ where: { sessionId } });
      if (session) {
        return session;
      }
    }
    throw error;
  }
}
