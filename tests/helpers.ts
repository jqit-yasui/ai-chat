import { type Locator, type Page, expect } from "@playwright/test";

export function userMessages(page: Page): Locator {
  return page.locator('[data-testid="chat-message"][data-role="user"]');
}

export function assistantMessages(page: Page): Locator {
  return page.locator('[data-testid="chat-message"][data-role="assistant"]');
}

/**
 * メッセージ入力欄にテキストを入力し、送信ボタンを押して、
 * SSEストリーミング応答を最後まで受信し終えるまで待つ。
 * （画像添付は呼び出し側で事前に attachImages しておく）
 */
export async function sendAndWaitForReply(page: Page, text: string) {
  if (text) {
    await page.getByRole("textbox", { name: "メッセージ入力" }).fill(text);
  }

  const responsePromise = page.waitForResponse(
    (res) => res.url().includes("/api/chat") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: "送信" }).click();
  const response = await responsePromise;
  expect(response.ok(), `POST /api/chat failed with status ${response.status()}`).toBeTruthy();
  // response.body() はストリームを最後まで読み切るまで解決しないため、
  // これを待つことでSSEの受信完了（=画面上の応答確定）を保証できる。
  await response.body();
}

export async function attachImages(page: Page, filePaths: string[]) {
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "画像を添付" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(filePaths);
}
