# AIチャット

OpenRouter 経由の無料LLMを利用した、認証なしの汎用チャットアプリケーション。詳細な仕様は [CLAUDE.md](./CLAUDE.md) を参照。実装の進捗・詳細は [TODO.md](./TODO.md) を参照。

## 技術スタック

- フロントエンド / API サーバー: Next.js (App Router) + Hono（`app/api/[[...route]]` 配下にマウント）
- AI エージェントフレームワーク: [Mastra](https://mastra.ai/)（[OpenRouter](https://openrouter.ai/) 経由で無料モデルを利用。既定: `openai/gpt-oss-20b:free`）
- ORM / DB: Prisma + MongoDB
- デプロイ先: Google Cloud Run

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

`postinstall` で `prisma generate` が自動実行され、Prisma Client が生成されます。

### 2. MongoDB の準備

本番運用は [MongoDB Atlas](https://www.mongodb.com/atlas) の M0（無料）クラスターを利用する想定です。

ローカル開発では、Prisma がトランザクションを利用する関係で **レプリカセットとして動作する MongoDB** が必要です（単一ノードのレプリカセットで構いません）。Docker が使える環境では例えば以下のように起動できます。

```bash
docker run -d --name mongo-dev -p 27017:27017 mongo:8 --replSet rs0
docker exec mongo-dev mongosh --eval 'rs.initiate({_id: "rs0", members: [{_id: 0, host: "127.0.0.1:27017"}]})'
```

### 3. 環境変数の設定

`.env.example` を `.env.local` にコピーして値を埋めてください（Prisma CLI 用に `.env` にも同じ内容を用意してください）。

```bash
cp .env.example .env.local
cp .env.example .env
```

| 変数名 | 説明 |
|---|---|
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/keys) で発行する API キー。`lib/mastra/agents/chat-agent.ts` の `createOpenRouter()` が読み取る |
| `DATABASE_URL` | MongoDB の接続文字列。ローカル例: `mongodb://127.0.0.1:27017/ai_chat?replicaSet=rs0`、Atlas例: `mongodb+srv://<user>:<password>@<cluster>/ai_chat` |

> **無料モデルについて**: `lib/mastra/agents/chat-agent.ts` で指定している OpenRouter の `:free` モデルは、アップストリームプロバイダーの共有プールを利用するため、時間帯によって一時的なレート制限（`429`）が発生することがあります。発生した場合は [OpenRouter のモデル一覧](https://openrouter.ai/models?max_price=0) から別の `:free` モデルに切り替えるか、時間を置いて再試行してください。

### 4. スキーマの反映

```bash
npx prisma db push
```

### 5. 開発サーバーの起動

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開くとチャット画面が表示されます。

## その他のコマンド

```bash
npm run lint          # ESLint
npm run format        # Prettier で整形
npm run format:check  # Prettier のチェックのみ
npm run build          # 本番ビルド（standalone 出力）
npm run start           # ビルド済みアプリの起動
```

## デプロイ（Google Cloud Run）

`deploy/deploy.sh` に、Google Cloud プロジェクトの設定から Cloud Run へのデプロイ、予算アラート設定までを行うスクリプトを用意しています。ローカルに Docker は不要です（`gcloud run deploy --source .` が Cloud Build 上でリモートビルドします）。

```bash
# gcloud auth login 済みであること
OPENROUTER_API_KEY="sk-or-v1-..." \
DATABASE_URL="mongodb+srv://..." \
./deploy/deploy.sh
```

実行前に `deploy/deploy.sh` 冒頭の `PROJECT_ID` / `REGION` / `BILLING_ACCOUNT_ID` などを自分の環境に合わせて書き換えてください。

MongoDB Atlas 側の Network Access は、Cloud Run の送信元 IP が固定されないため `0.0.0.0/0`（どこからでも許可）を設定し、接続文字列の秘匿性でアクセスを制御する運用としています。

## 仕様・設計判断の詳細

- [CLAUDE.md](./CLAUDE.md): 仕様書（アーキテクチャ、データモデル、API設計、コスト方針など）
- [TODO.md](./TODO.md): 実装計画と各フェーズの実施内容・保留事項の記録
