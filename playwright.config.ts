import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  // 無料枠LLM（OpenRouter）への実リクエストを伴うE2Eテストのため、
  // 同時実行によるレート制限（429）を避けて直列実行する。
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // LLM応答（モデルのフォールバックを含む）は数十秒かかることがあるため、
  // デフォルトの30秒より長めに設定する。
  timeout: 90_000,
  expect: {
    timeout: 30_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // PLAYWRIGHT_BASE_URL が指定されていない場合のみ、ローカルの dev サーバーを自動起動する
  // （本番/検証環境を対象にする場合は webServer を使わず、既存の URL に直接アクセスする）。
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
