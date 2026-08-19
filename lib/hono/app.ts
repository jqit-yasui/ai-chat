import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/hono/session";
import { chatRoute } from "@/lib/hono/routes/chat";
import { messagesRoute } from "@/lib/hono/routes/messages";
import type { AppEnv } from "@/lib/hono/types";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", sessionMiddleware);

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/", chatRoute);
app.route("/", messagesRoute);

export { app };
