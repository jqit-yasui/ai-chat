@AGENTS.md

# AIチャットボット 仕様書

## 概要

Claude.ai や ChatGPT のような、単一の会話画面でユーザーと AI が対話する汎用チャットアプリケーション。ログイン機能は持たず、誰でもすぐに利用できることを目指す。インフラ・LLM ともに無料枠内で完結させることを重視する。

- 用途: 汎用チャットアプリ（特定ドメインに特化しない）
- UI・エージェント応答言語: 日本語
- 会話スレッド: 単一会話のみ（複数スレッドの作成・切り替えは行わない）
- 応答表示: ストリーミングなし（生成完了後に一括表示）
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
| 認証 | なし |

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
  createdAt DateTime @default(now())
}
```

## API 設計（Hono, 概略）

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/chat` | ユーザーのメッセージを受け取り、Mastra エージェント経由で OpenRouter（無料モデル）に問い合わせ、応答をまとめて返す。ユーザー発言・AI 応答の両方を DB に保存する |
| GET | `/api/messages` | 現在のセッション（Cookie の `session_id`）に紐づく会話履歴を取得する |

- ストリーミングは行わないため、`/api/chat` は AI の応答が完成してから JSON レスポンスを返す。

## 環境変数

| 変数名 | 用途 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API キー（https://openrouter.ai/keys で発行。`lib/mastra/agents/chat-agent.ts` の `createOpenRouter()` が読み取る） |
| `DATABASE_URL` | MongoDB Atlas への接続文字列 |

## デプロイ

- Google Cloud の Cloud Run にコンテナとしてデプロイする。
- Next.js（フロント）と Hono（API）は同一コンテナ内で動作させる。
- MongoDB は MongoDB Atlas（マネージドサービス）を利用し、Cloud Run から接続文字列経由でアクセスする。

## 実装方針・注意点

- 認証機能は実装しない。将来的にログイン機能を追加する可能性を考慮し、`Session` モデルは `session_id` を軸にした設計とし、後からユーザーアカウントに紐付けやすい構造にしておく。
- 複数会話スレッドの UI（サイドバーでの会話切り替えなど）は現時点では実装しない。
- AI 応答の Markdown 整形（コードブロック、箇条書きの装飾表示）は行わない。プレーンテキストとして表示する。
- Mastra エージェントはツール呼び出しや外部ドキュメント参照（RAG）を持たない、シンプルな会話のみのエージェントとして構成する。
- LLM は当初 Mastra の Model Router 経由で Google Gemini API 直結（`model: "google/..."` 文字列指定）を採用していたが、Google 側が進めている API キー形式の移行（新形式の認証キー、`AQ.` プレフィックス）と Gemini API 側の互換性不具合により認証エラーが解消できず、**OpenRouter 経由**（`@openrouter/ai-sdk-provider` + `createOpenRouter()` でモデルインスタンスを直接 `Agent` の `model` に渡す方式）に変更した。
- OpenRouter の無料モデル（`:free` サフィックス）はアップストリームプロバイダーの共有プールを利用するため、時間帯によって `429`（一時的なレート制限）が発生し得る。エラーハンドリングは他の Gemini/LLM エラーと同様に扱い、自動リトライは行わない。
