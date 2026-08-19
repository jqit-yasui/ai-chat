import { handle } from "hono/vercel";
import { app } from "@/lib/hono/app";

export const GET = handle(app);
export const POST = handle(app);
