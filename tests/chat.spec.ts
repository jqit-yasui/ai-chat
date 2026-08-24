import { test, expect } from "@playwright/test";
import path from "node:path";
import { assistantMessages, attachImages, sendAndWaitForReply, userMessages } from "./helpers";

const IMAGE_1 = path.join(__dirname, "fixtures", "image-1.png");
const IMAGE_2 = path.join(__dirname, "fixtures", "image-2.png");
const IMAGE_3 = path.join(__dirname, "fixtures", "image-3.png");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "メッセージ入力" })).toBeVisible();
});

test("テキストメッセージを送信するとAIから応答が返る", async ({ page }) => {
  await sendAndWaitForReply(page, "こんにちは");

  await expect(userMessages(page)).toHaveCount(1);
  await expect(assistantMessages(page)).toHaveCount(1);
  await expect(userMessages(page).last()).toHaveText("こんにちは");
  await expect(assistantMessages(page).last()).not.toHaveText("");
});

test("画像を1枚添付して送信するとAIから応答が返る", async ({ page }) => {
  await attachImages(page, [IMAGE_1]);
  await expect(page.getByRole("button", { name: /を削除$/ })).toHaveCount(1);

  await sendAndWaitForReply(page, "この画像には何が写っていますか？");

  await expect(userMessages(page)).toHaveCount(1);
  await expect(assistantMessages(page)).toHaveCount(1);
  await expect(userMessages(page).last().locator("img")).toHaveCount(1);
  await expect(assistantMessages(page).last()).not.toHaveText("");
});

test("画像を3枚添付して送信するとAIから応答が返る", async ({ page }) => {
  await attachImages(page, [IMAGE_1, IMAGE_2, IMAGE_3]);
  await expect(page.getByRole("button", { name: /を削除$/ })).toHaveCount(3);
  // 上限（3枚）に達しているため、これ以上は添付できない
  await expect(page.getByRole("button", { name: "画像を添付" })).toBeDisabled();

  await sendAndWaitForReply(page, "この3枚の画像について、それぞれ何が写っているか教えてください");

  await expect(userMessages(page)).toHaveCount(1);
  await expect(assistantMessages(page)).toHaveCount(1);
  await expect(userMessages(page).last().locator("img")).toHaveCount(3);
  await expect(assistantMessages(page).last()).not.toHaveText("");
});
