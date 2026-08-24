# AIチャット

OpenRouter 経由の無料LLMを利用した、認証なしの汎用チャットアプリケーション。詳細な仕様は [CLAUDE.md](./CLAUDE.md) を参照。実装の進捗・詳細は [TODO.md](./TODO.md) を参照。

## 技術スタック

- フロントエンド / API サーバー: Next.js (App Router) + Hono（`app/api/[[...route]]` 配下にマウント）
- AI エージェントフレームワーク: [Mastra](https://mastra.ai/)（[OpenRouter](https://openrouter.ai/) 経由で無料モデルを利用。既定: `z-ai/glm-5.2:free`）
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
| `BASIC_AUTH_USER` | 本番環境（Cloud Run）保護用の Basic 認証ユーザー名。`middleware.ts` が参照する。ローカル開発時（`npm run dev` / `NODE_ENV=production` 以外）は未設定でも動作する |
| `BASIC_AUTH_PASSWORD` | 本番環境（Cloud Run）保護用の Basic 認証パスワード。`middleware.ts` が参照する。ローカル開発時は未設定でも動作する |

> **無料モデルについて**: `lib/mastra/agents/chat-agent.ts` で指定している OpenRouter の `:free` モデルは、アップストリームプロバイダーの共有プールを利用するため、時間帯によって一時的なレート制限（`429`）が発生することがあります。発生した場合は [OpenRouter のモデル一覧](https://openrouter.ai/models?max_price=0) から別の `:free` モデルに切り替えるか、時間を置いて再試行してください。無料モデルの中には画像入力（vision）に対応していないものもあり、その場合も自動的に次の候補モデルへフォールバックしますが、すべて非対応の場合はエラーになります。

### 本番環境の Basic 認証

Cloud Run の IAM は `allUsers`（誰でもアクセス可能）に設定して運用するため、代わりにアプリ側（`middleware.ts`）で簡易的な Basic 認証をかけています。`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` は本番相当（`NODE_ENV=production`）で起動した場合のみ適用され、`npm run dev` によるローカル開発時は未設定のままでも認証なしでアクセスできます。

本番にデプロイする際は、`OPENROUTER_API_KEY` / `DATABASE_URL` と合わせて `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` も環境変数として設定してください（後述の「デプロイ」章を参照）。値を空にすると Cloud Run 上で誰も認証を突破できなくなる（＝閉じた状態）ため、必ず実際の値を設定してください。

### 画像添付（マルチモーダル）

チャット入力欄から画像を添付できます（ファイル選択 / ドラッグ&ドロップ、1メッセージにつき最大3枚、1枚あたり4MBまで、jpg/png/webp/gif のみ）。画像は外部ストレージを使わず、Base64データURLとして MongoDB に直接保存されます。

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
BASIC_AUTH_USER="your-username" \
BASIC_AUTH_PASSWORD="your-password" \
./deploy/deploy.sh
```

`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` は Cloud Run の IAM を `allUsers`（誰でもアクセス可能）にしたまま運用するための、アプリ側の簡易 Basic 認証に使う値です（詳細は前述の「本番環境の Basic 認証」を参照）。

実行前に `deploy/deploy.sh` 冒頭の `PROJECT_ID` / `REGION` / `BILLING_ACCOUNT_ID` などを自分の環境に合わせて書き換えてください。

MongoDB Atlas 側の Network Access は、Cloud Run の送信元 IP が固定されないため `0.0.0.0/0`（どこからでも許可）を設定し、接続文字列の秘匿性でアクセスを制御する運用としています。

## 仕様・設計判断の詳細

- [CLAUDE.md](./CLAUDE.md): 仕様書（アーキテクチャ、データモデル、API設計、コスト方針など）
- [TODO.md](./TODO.md): 実装計画と各フェーズの実施内容・保留事項の記録
