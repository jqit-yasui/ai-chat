import { test, expect } from "@playwright/test";
import { assistantMessages, sendAndWaitForReply, userMessages } from "./helpers";

test("リロード後、送信したメッセージと応答が履歴として復元される", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "メッセージ入力" })).toBeVisible();

  await sendAndWaitForReply(page, "こんにちは");

  await expect(userMessages(page)).toHaveCount(1);
  await expect(assistantMessages(page)).toHaveCount(1);
  const assistantReplyText = await assistantMessages(page).last().innerText();
  expect(assistantReplyText.trim().length).toBeGreaterThan(0);

  // session_id Cookie は維持したまま、会話履歴の再取得（GET /api/messages）を待ってリロードする
  const historyResponsePromise = page.waitForResponse(
    (res) => res.url().includes("/api/messages") && res.request().method() === "GET",
  );
  await page.reload();
  await historyResponsePromise;

  await expect(userMessages(page)).toHaveCount(1);
  await expect(assistantMessages(page)).toHaveCount(1);
  await expect(userMessages(page).last()).toHaveText("こんにちは");
  // リロード後もLLMを再実行せず、保存済みの同じ応答が復元されることを確認する
  await expect(assistantMessages(page).last()).toHaveText(assistantReplyText);
});
