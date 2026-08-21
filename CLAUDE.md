@AGENTS.md

# AIチャットボット 仕様書

## 概要

Claude.ai や ChatGPT のような、単一の会話画面でユーザーと AI が対話する汎用チャットアプリケーション。ログイン機能は持たず、誰でもすぐに利用できることを目指す。インフラ・LLM ともに無料枠内で完結させることを重視する。

- 用途: 汎用チャットアプリ（特定ドメインに特化しない）
- UI・エージェント応答言語: 日本語
- 会話スレッド: 単一会話のみ（複数スレッドの作成・切り替えは行わない）
- 応答表示: ストリーミング表示（SSE で逐次受信し、文字を逐次追加表示する）
- Markdown 整形: 行わない（プレーンテキスト表示）

## 技術スタック

| 領域 | 技術 |
|---|---|
| フロントエンド | Next.js (App Router) |
| API サーバー | Hono（Next.js の API Routes を代替。`app/api/[[...route]]/route.ts` 配下にマウント） |
| AI エージェントフレームワーク | Mastra |
| LLM | OpenRouter 経由の無料モデル（`@openrouter/ai-sdk-provider`。既定: `openai/gpt-oss-20b:free`） |
| ORM | Prisma |
| データベース | MongoDB（MongoDB Atlas, M0 無料クラスター） |
| デプロイ先 | Google Cloud Run（コンテナデプロイ） |
| 認証 | アプリ内のユーザーアカウント認証はなし。本番環境（Cloud Run）のみ、外部公開を制限する簡易 Basic 認証を `middleware.ts` で適用（詳細は本セクション末尾を参照） |

## コスト方針

インフラ・LLM ともに無料枠内で完結させる構成とする。

- LLM: OpenRouter の無料枠モデル（`:free` サフィックス）を利用する。無料モデルはアップストリームプロバイダーの共有プールで一時的にレート制限（429）される場合があるため、その場合はモデルを切り替えるか時間を置いて再試行する
- DB: MongoDB Atlas **M0（Free）クラスター** を利用する（M10 以上の有料クラスターは選択しない）
- Cloud Run: `min-instances=0` を必須とする（1 以上にすると常時課金になるため）。CPU 割り当ては「リクエスト処理中のみ」とする
- Secret Manager は使わず、Cloud Run の環境変数に直接設定する
- Artifact Registry はイメージサイズと世代数に注意する（無料枠 0.5GB。マルチステージビルド＋クリーンアップポリシーで超過を防ぐ）
- 予算アラートを設定し、誤課金を検知できるようにする

## アーキテクチャ

```
[Browser]
   │  Cookie: session_id (匿名ID, 未設定なら初回アクセス時に発行)
   ▼
[Next.js App Router]
   │  UI (Client Components) ── チャット画面のみ
   ▼
[Hono API (app/api/[[...route]])]
   │  会話履歴の読み書き (Prisma) / Mastra エージェント呼び出し
   ├─→ [Prisma Client] ─→ [MongoDB Atlas]
   └─→ [Mastra Agent] ─→ [OpenRouter API] ─→ 各種無料モデル
```

- Next.js と Hono API は同一アプリ内（Cloud Run 上の 1 コンテナ）にまとめてデプロイする。別サーバーには分離しない。
- Mastra エージェントはツール呼び出しや RAG を持たない、シンプルな対話のみのエージェントとして定義する。
- 認証がないため、ユーザーの区別はブラウザに保存する匿名セッション ID（Cookie）で行う。

## 会話・セッションの扱い

- 初回アクセス時、`session_id`（UUID など）を発行し、Cookie に保存する。
- 会話履歴（ユーザー発言・AI 応答）は `session_id` に紐づけて MongoDB に保存する。
- 同じブラウザで再訪した場合、Cookie の `session_id` を使って過去の会話（単一スレッド）を継続表示する。
- ユーザーアカウントという概念は持たない（`session_id` が唯一の識別子）。

## データモデル（Prisma / MongoDB, 概略）

```prisma
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Session {
  id        String    @id @default(auto()) @map("_id") @db.ObjectId
  sessionId String    @unique // Cookie に保存する匿名ID
  messages  Message[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model Message {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  session   Session  @relation(fields: [sessionId], references: [id])
  sessionId String   @db.ObjectId
  role      String   // "user" | "assistant"
  content   String
  images    String[] @default([]) // 添付画像（Base64 データURL）。0〜3枚
  createdAt DateTime @default(now())
}
```

## API 設計（Hono, 概略）

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/chat` | ユーザーのメッセージ（テキスト・画像）を受け取り、Mastra エージェント経由で OpenRouter（無料モデル）に問い合わせ、応答を SSE（`text/event-stream`）で逐次返す。ユーザー発言・AI 応答の両方を DB に保存する |
| GET | `/api/messages` | 現在のセッション（Cookie の `session_id`）に紐づく会話履歴を取得する |

- `POST /api/chat` は成功時、SSE（`text/event-stream`）でレスポンスを返す。`lib/hono/routes/chat.ts` が `hono/streaming` の `streamSSE` を使い、`event: chunk`（`{ text: string }` の差分テキスト）を逐次送出し、完了時に `event: done`（`{ userMessage, assistantMessage }`、非ストリーミング時と同じ形）を送出する。DB に保存する `Message` はストリーム完了後の最終テキストのみで、途中経過（チャンク）は保存しない。バリデーションエラーやモデル呼び出し自体の失敗（最初のチャンクを受け取れない場合）など、ストリーム開始前に確定するエラーは従来どおり `c.json({ error }, status)` で返し、ストリーム開始後に発生したエラーは `event: error`（`{ error: string }`）として送出する。フロント（`components/chat/chat-window.tsx`）はレスポンスの `Content-Type` を見て、`text/event-stream` の場合は `lib/sse.ts` の `parseSseStream` でパースし、SSE でない場合（＝エラー）は JSON として扱う。
- `POST /api/chat` のリクエストボディは `{ message: string, images?: string[] }`。`images` は `data:image/png;base64,...` 形式の Base64 データURL配列（最大3枚、1枚あたり4MB、jpg/png/webp/gif のみ）。`message` と `images` の少なくとも一方は必須。
- 画像は外部ストレージを使わず、`Message.images`（`String[]`）として MongoDB に直接保存する（無料枠方針との整合を優先し、追加インフラを持たない構成とした）。
- LLM への画像入力（vision）に対応していない無料モデルがあり得るため、`lib/mastra/agents/chat-agent.ts` のモデルフォールバック機構は、レート制限（429）に加えて画像非対応エラーも検知して次候補モデルへフォールバックする。どのモデルが実際に vision 対応かは事前に決め打ちせず、エラー内容から判定する。ストリーミング対応後は、この判定を「各候補モデルから最初の意味のあるチャンクを受け取れるか」の時点でのみ行う（一度クライアントへチャンクの送出を開始した後はフォールバックしない）。

## 環境変数

| 変数名 | 用途 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API キー（https://openrouter.ai/keys で発行。`lib/mastra/agents/chat-agent.ts` の `createOpenRouter()` が読み取る） |
| `DATABASE_URL` | MongoDB Atlas への接続文字列 |
| `BASIC_AUTH_USER` | 本番環境（Cloud Run）保護用の Basic 認証ユーザー名（`middleware.ts` が読み取る。`NODE_ENV=production` のときのみ適用） |
| `BASIC_AUTH_PASSWORD` | 本番環境（Cloud Run）保護用の Basic 認証パスワード（`middleware.ts` が読み取る。`NODE_ENV=production` のときのみ適用） |

## デプロイ

- Google Cloud の Cloud Run にコンテナとしてデプロイする。
- Next.js（フロント）と Hono（API）は同一コンテナ内で動作させる。
- MongoDB は MongoDB Atlas（マネージドサービス）を利用し、Cloud Run から接続文字列経由でアクセスする。

## 実装方針・注意点

- 認証機能は実装しない。将来的にログイン機能を追加する可能性を考慮し、`Session` モデルは `session_id` を軸にした設計とし、後からユーザーアカウントに紐付けやすい構造にしておく。
- 上記の「認証機能なし」はユーザーアカウント単位の認証（ログイン）の話であり、本番環境（Cloud Run）のみ `middleware.ts` でアプリ全体にかかる簡易 Basic 認証（`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`）を適用している。これは Cloud Run の IAM を `allUsers`（誰でもアクセス可能）にしたまま外部公開を制限するための対策であり、ユーザーごとの識別・アカウント管理を行うものではない。`NODE_ENV=production` の場合のみ適用され、ローカル開発（`npm run dev`）では適用されない。
- 複数会話スレッドの UI（サイドバーでの会話切り替えなど）は現時点では実装しない。
- AI 応答の Markdown 整形（コードブロック、箇条書きの装飾表示）は行わない。プレーンテキストとして表示する。
- Mastra エージェントはツール呼び出しや外部ドキュメント参照（RAG）を持たない、シンプルな会話のみのエージェントとして構成する。
- LLM は当初 Mastra の Model Router 経由で Google Gemini API 直結（`model: "google/..."` 文字列指定）を採用していたが、Google 側が進めている API キー形式の移行（新形式の認証キー、`AQ.` プレフィックス）と Gemini API 側の互換性不具合により認証エラーが解消できず、**OpenRouter 経由**（`@openrouter/ai-sdk-provider` + `createOpenRouter()` でモデルインスタンスを直接 `Agent` の `model` に渡す方式）に変更した。
- OpenRouter の無料モデル（`:free` サフィックス）はアップストリームプロバイダーの共有プールを利用するため、時間帯によって `429`（一時的なレート制限）が発生し得る。エラーハンドリングは他の Gemini/LLM エラーと同様に扱い、自動リトライは行わない。
