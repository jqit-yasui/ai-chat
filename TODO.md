# 実行計画 / TODO

CLAUDE.md の仕様に基づく実装タスクリスト。上から順に進めることを想定。

> **コスト方針**: インフラ・LLMともに無料枠内で完結させる構成。
> - LLM: OpenRouter 経由の無料モデル（`:free` サフィックス。既定 `openai/gpt-oss-20b:free`）
> - DB: MongoDB Atlas **M0（Free）クラスター**
> - Cloud Run: `min-instances=0` 必須（1以上にすると常時課金になるため）
> - Secret Manager は使わず、Cloud Run の環境変数に直接設定
> - Artifact Registry はイメージサイズと世代数に注意（無料枠0.5GB。マルチステージビルド＋自動クリーンアップポリシーで超過を防ぐ）

## 1. プロジェクト初期セットアップ

- [x] `create-next-app` で Next.js (App Router, TypeScript) プロジェクトを作成
- [x] Hono と `hono/vercel`（または Node アダプター）を導入
- [x] `app/api/[[...route]]/route.ts` を作成し、Hono アプリをマウントする
- [x] Hono の疎通確認用エンドポイント（例: `GET /api/health`）を作成し、動作確認
- [x] ESLint / Prettier など最低限の Lint 設定を導入
- [x] `.env.local` / `.env.example` を作成（`GEMINI_API_KEY`, `DATABASE_URL` のプレースホルダを記載）

## 2. データベース（Prisma + MongoDB）

- [x] MongoDB Atlas で **M0（Free）クラスター** を作成し、接続文字列を取得（M10以上の有料クラスターを誤って選択しないよう注意）
  - ユーザー側で Atlas M0 クラスターを作成し、`.env.local` の `DATABASE_URL` を `mongodb+srv://...` 接続文字列に設定済み
  - 初回設定時、接続文字列のパスワード部分が Atlas 画面のプレースホルダー（`<password>`）のまま山括弧付きで残っており `bad auth : authentication failed` で失敗する事象があったが、実パスワードに置き換えて解消
- [x] Prisma を導入し、`provider = "mongodb"` で `schema.prisma` を作成（MongoDB 対応のため Prisma は `6.19.3` に固定）
- [x] `Session` / `Message` モデルを CLAUDE.md の設計どおりに定義
- [x] `prisma generate` を実行し、Prisma Client を生成（`prisma db push` 経由で自動実行、コレクション作成も確認済み）
- [x] Prisma Client のシングルトン初期化ファイル（`lib/prisma.ts`）を作成
- [x] MongoDB への接続確認（read/write テスト）
  - ローカル MongoDB: Session/Message の作成・取得・削除で確認済み（開発時代用）
  - **MongoDB Atlas（M0）**: `prisma db push` でのスキーマ反映、および Session/Message の作成・取得・削除による read/write テストで接続確認済み

## 3. セッション管理（Cookie ベース匿名ID）

- [x] Hono ミドルウェアとして、`session_id` Cookie の有無を確認し、なければ UUID を発行して Set-Cookie するロジックを実装（`lib/hono/session.ts`, `app.use("*", sessionMiddleware)` で全ルートに適用）
- [x] `session_id` に対応する `Session` レコードが DB に存在しなければ作成する処理を実装
  - 当初は `prisma.session.upsert` を使用していたが、MongoDB Atlas M0（トランザクション非対応）でも確実に動作するよう、`findUnique` → 存在しなければ `create` という非トランザクションな実装（`findOrCreateSession`, `lib/hono/session.ts`）に書き換え済み。まれに同一 `sessionId` で `create` が競合した場合は一意制約エラー（`P2002`）を捕捉し `findUnique` で再取得するフォールバックを追加。Atlas 上で新規作成・再利用・重複なしを実地確認済み
- [x] Cookie の属性（`HttpOnly`, `SameSite`, 有効期限など）を決定して設定（`HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=1年`, 本番のみ `Secure`）

## 4. Mastra エージェントの実装

- [x] Mastra を導入し、プロジェクトに組み込む（`@mastra/core` + `zod`。`lib/mastra/index.ts` に `Mastra` インスタンス、`lib/mastra/agents/chat-agent.ts` にエージェント定義）
- [x] LLM プロバイダとして設定・接続確認済み（**最終的に OpenRouter を採用**。経緯は以下のとおり）
  1. 当初は Mastra 標準の **Model Router**（`model: "google/gemini-2.5-flash"` 文字列指定）で Google Gemini API 直結を採用（`@ai-sdk/google` 不要、公式推奨の方式）
  2. Google AI Studio 発行の API キーが新形式（`AQ.` プレフィックスの Authorization Key）になっており、`401 ACCESS_TOKEN_TYPE_UNSUPPORTED` エラーで Gemini API との接続に失敗（Google 側の API キー移行に伴う既知の不具合。GitHub/Google 公式フォーラムで多数報告あり、2026年8月時点で解消せず）
  3. ユーザー判断により **Gemini 直結を断念し、OpenRouter 経由に切り替え**。`@openrouter/ai-sdk-provider` を導入し、`createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })` で生成したモデルインスタンスを `Agent` の `model` に直接渡す方式に変更（Mastra の Model Router 文字列指定ではなく、AI SDK プロバイダインスタンスを渡す方式）
  4. 環境変数名を `GOOGLE_GENERATIVE_AI_API_KEY` から `OPENROUTER_API_KEY` に変更。`.env` / `.env.local` / `.env.example` / CLAUDE.md / README.md / `deploy/deploy.sh` を更新済み
  5. モデルは無料枠方針に基づき `:free` サフィックス付きを選定。当初指定の `meta-llama/llama-3.3-70b-instruct:free` は OpenRouter 側で無料提供が終了していたため利用不可。`z-ai/glm-5.2:free` → `google/gemma-4-31b-it:free` は共有プールの一時的なレート制限（429）で失敗。最終的に **`openai/gpt-oss-20b:free`** で実際の応答を確認できた
- [x] ツール呼び出し・RAG なしの、シンプルな対話用エージェントを定義（`chat-agent`、ツール未登録）
- [x] システムプロンプト（日本語で応答する旨など）を設定（`instructions` に日本語での丁寧な応答を指示）
- [x] エージェント単体で簡単な入力→応答が返ることをスクリプト等で確認
  - `POST /api/chat` 経由で実際に `openai/gpt-oss-20b:free` から日本語の応答を取得できることを確認済み（実際のAI応答による確認は本タスクが初）
- [x] LLM のレート制限・タイムアウト時の挙動を確認し、実装側でハンドリング方針を決める
  - OpenRouter の無料モデルは共有プールのため `429`（一時的なレート制限）が発生し得ることを実際に確認済み（`z-ai/glm-5.2:free`, `google/gemma-4-31b-it:free` で発生）
  - ハンドリング方針は決定済み・実装済み: 自動リトライ／指数バックオフは行わず、LLM API エラー（レート制限含む）はフェーズ5の `POST /api/chat` でそのまま捕捉し、ユーザーには日本語の穏当なエラーメッセージを返す。フェーズ7で追加したタイムアウト（30秒, `AbortSignal.timeout`）もそのまま有効

## 5. API 実装（Hono）

- [x] `POST /api/chat`（`lib/hono/routes/chat.ts`）
  - [x] リクエストボディ（ユーザーメッセージ）のバリデーション（`@hono/zod-validator` + zod。空文字・4000文字超を拒否し 400 を返却、動作確認済み）
  - [x] `session_id` に紐づくユーザーメッセージを `Message` として保存（`dbSessionId` はセッションミドルウェアの `c.get("dbSessionId")` から取得）
  - [x] Mastra エージェントを呼び出し、LLM（OpenRouter）からの応答を取得（非ストリーミング。`agent.generate(message)` → `result.text`）
  - [x] AI 応答を `Message` として保存
  - [x] 応答を JSON で返却（`{ userMessage, assistantMessage }`）
- [x] `GET /api/messages`（`lib/hono/routes/messages.ts`）
  - [x] `session_id` に紐づく `Message` を時系列（`createdAt` 昇順）で取得して返却
- [x] エラーハンドリング（LLM API エラー・レート制限、DB エラー時の適切なレスポンス）
  - リトライは行わず、DB 保存失敗時は 500、LLM 呼び出し失敗時は 502（タイムアウト時は 504）で日本語の穏当なメッセージを返却。ユーザーメッセージは LLM 呼び出し前に保存するため、AI 応答生成に失敗してもユーザーの入力自体は失われない設計
  - 動作確認: API キー未設定・OpenRouter 側の一時的なレート制限の両方で `POST /api/chat` が適切なエラーを返すことを確認済み。最終的に `openai/gpt-oss-20b:free` で実際のAI応答（200）も確認済み（フェーズ4参照）

## 6. フロントエンド（チャットUI）

- [x] チャット画面のページを作成（単一ページ、単一会話スレッド。`app/page.tsx` → `components/chat/chat-window.tsx`）
- [x] メッセージ一覧表示コンポーネント（`components/chat/message-list.tsx`。ユーザー/AIの発言を左右・色で区別、`whitespace-pre-wrap` のプレーンテキスト表示、Markdown整形なし）
- [x] メッセージ入力フォーム（`components/chat/message-input.tsx`。送信ボタン、Enter送信。日本語IME変換確定Enterでの誤送信を `isComposing` 判定で防止）
- [x] 初回表示時に `GET /api/messages` で既存の会話履歴を取得して表示
- [x] メッセージ送信時に `POST /api/chat` を呼び出し、応答が返るまでの送信中インジケーター（ユーザー発言を即時表示する楽観的UI + 「AIが入力中...」表示、入力欄・送信ボタンを送信中は無効化）
- [x] エラー時（API失敗など）のUI表示（赤背景のエラーバナーで日本語メッセージを表示。ライト/ダーク両対応）
- [x] 日本語UI文言の整備（プレースホルダ「メッセージを入力...」、ボタン「送信」、タイトル・空状態・エラー文言まで日本語で統一。`<html lang="ja">` に変更）

## 7. 動作確認・調整

- [x] ローカル環境でE2Eの対話フロー（新規セッション発行→送信→履歴保存→再訪時の履歴復元）を確認
  - Playwright（Chromium）で自動テストを実施: 新規訪問での `session_id` Cookie発行 → メッセージ送信 → 再訪（別タブ、同一Cookie）で2件の履歴が正しい順序で復元されることを確認済み
- [x] 複数ブラウザ/シークレットウィンドウで、セッションが正しく分離されることを確認
  - 別ブラウザコンテキスト（シークレットウィンドウ相当）では異なる `session_id` が発行され、双方向で会話履歴が漏れないことを確認済み（ブラウザA⇔Bのメッセージが互いに見えない）
- [x] LLM API のレート制限・タイムアウト時の挙動を確認
  - 実装を追加: `POST /api/chat` に `AbortSignal.timeout(30_000)` による明示的な30秒タイムアウトを追加（`lib/hono/routes/chat.ts`）。タイムアウト時は他の LLM エラーと区別し、504 と専用の日本語メッセージ（「AIの応答がタイムアウトしました。しばらく時間をおいて再度お試しください。」）を返す
  - タイムアウト検知ロジック自体は、ハングする処理に対する単体検証で正しく動作することを確認済み（500msタイムアウト設定で約501msにて正しく検知）
  - 追記: フェーズ4で OpenRouter に切り替えた後、実際に無料モデルの共有プールで `429` レート制限が発生することを実地で確認済み（汎用の LLM エラーハンドリング, 502 で適切に捕捉されることも確認）。タイムアウト（504）自体は実際の長時間ハングでの実地確認はまだだが、機構自体は検証済み

## 8. デプロイ（Google Cloud Run）

- [x] Next.js + Hono を1コンテナで動かす `Dockerfile` を作成（マルチステージビルド、standalone出力でイメージを軽量化）
  - `next.config.ts` に `output: "standalone"` を追加。`package.json` に `postinstall: "prisma generate"` を追加し、ビルド前に確実に Prisma Client が生成されるようにした
  - ベースイメージは `node:22-slim`（Debian系）を採用。ローカルで生成される Prisma のクエリエンジンバイナリ（`debian-openssl-3.0.x`）と一致するため、`binaryTargets` の追加設定なしで動作する（alpine系ベースにする場合は要追加設定）
- [x] `.dockerignore` を作成（`node_modules`, `.next`, `.env*`（`.env.example` は除く）などを除外。ビルドコンテキストに秘密情報を含めない）
- [x] ローカルでのコンテナ起動確認
  - 保留: このdevcontainer環境では `dockerd` が権限制約（`unshare`/bindマウントで `operation not permitted`）により正常動作せず、`docker build` を実際には実行できなかった（docker.io・docker-buildx導入、ネットワーク機能無効化、ツール側サンドボックス無効化まで試行したが不可）
  - 代替検証として実施・確認済み: `next build`（standalone出力）→ `.next/standalone/server.js` を単体で直接起動し、`/api/health` の応答、Prisma経由のMongoDB疎通（`GET /api/messages`）、本番モードでの Cookie `Secure` 属性付与まで確認。Dockerfile の各COPYステップは実際に生成された standalone 出力構成と一致させてあるため、Docker環境でも同様に動作する見込みが高い
  - 実際の `docker build` / `docker run` での最終確認は、Docker が使えるローカル環境かCI、または後述の `gcloud run deploy --source .`（Cloud Build によるリモートビルド）で行うことを推奨
- [x] Google Cloud プロジェクト・Artifact Registry の準備
- [x] Artifact Registry に **クリーンアップポリシー**（古いイメージの自動削除）を設定し、無料枠0.5GB超過を防ぐ
- [x] `OPENROUTER_API_KEY` / `DATABASE_URL` を Cloud Run の**環境変数**に直接設定（Secret Managerは使わない）
- [x] Cloud Run へデプロイ。**`min-instances=0`** を必ず設定（常時起動による課金を防止。コールドスタートは許容）
- [x] CPU割り当てを「リクエスト処理中のみ」に設定（Request-based課金。Cloud Run のデフォルト動作＝`--cpu-throttling`）
- [x] 予算アラートを$1程度で設定し、誤課金を検知できるようにする
- [ ] 公開URLで動作確認
- [ ] MongoDB Atlas 側で Cloud Run からのアクセスを許可する Network Access 設定を確認
  - 方針決定: Cloud Run は既定では送信元 IP が動的（固定IPにはCloud NAT + Serverless VPCコネクタ等の追加課金構成が必要で無料枠方針に反する）。そのため MongoDB Atlas の Network Access は `0.0.0.0/0`（どこからでも許可）を設定し、代わりに接続文字列（ユーザー名・パスワード）の秘匿性でアクセスを制御する運用とする

**上記の「準備」「設定」系タスクについて**: Google Cloud プロジェクト作成・Artifact Registry・Cloud Run デプロイ・予算アラートの作成には、ユーザー自身の Google Cloud アカウントでの認証・実行が必要（このエージェントは GCP 認証情報を持たない）。実行用の一式を用意済み:
  - `deploy/deploy.sh`: プロジェクト設定 → API有効化 → Artifact Registry作成 → クリーンアップポリシー適用 → `gcloud run deploy --source .`（**ローカルDocker不要**。Cloud Build がリモートで `Dockerfile` をビルドする）→ 予算アラート作成 → 公開URL表示、までを一気通貫で行うスクリプト
  - `deploy/artifact-registry-cleanup-policy.json`: 直近5バージョンのみ保持し、タグなしイメージは7日で削除するポリシー
  - 使い方: `deploy/deploy.sh` 冒頭の `PROJECT_ID` / `BILLING_ACCOUNT_ID` 等を書き換えた上で、`OPENROUTER_API_KEY` と `DATABASE_URL`（Atlas接続文字列）を環境変数で渡して実行（`gcloud auth login` 済みであること）
  - 「公開URLで動作確認」「Atlas Network Access設定」は、上記スクリプト実行後にユーザー側で行う想定として未完了のまま残す

## 9. 仕上げ

- [x] README（セットアップ手順・環境変数一覧・ローカル起動方法）を整備
  - `README.md` を create-next-app の雛形から全面的に書き換え。技術スタック、セットアップ手順（依存関係インストール→ローカルMongoDB準備→環境変数設定→`prisma db push`→`npm run dev`）、環境変数一覧、Lint/Format/Buildコマンド、`deploy/deploy.sh` を使ったCloud Runデプロイ手順を記載
- [x] 不要なログ・デバッグコードの削除
  - コード内の `console.*` 呼び出しはすべて `lib/hono/routes/*.ts` のエラーハンドリング内 `console.error`（意図した本番エラーログ）のみで、デバッグ用の残骸なし。`TODO`/`FIXME` コメントもなし
  - create-next-app 由来の未使用アセット（`public/next.svg`, `vercel.svg`, `globe.svg`, `file.svg`, `window.svg`）を削除（`app/page.tsx` を書き換えた際にどこからも参照されなくなっていた）
  - 開発中に生成された `tsconfig.tsbuildinfo`（`.gitignore` 対象のビルドキャッシュ）を削除
- [x] 最終的な通し動作確認
  - 本番Cloud Run URLでの確認は、フェーズ8の実デプロイ（ユーザー側での `deploy/deploy.sh` 実行）後に別途必要
  - 代替として、クリーンな状態から `npm run lint` / `npm run build` が通ることを確認した上で、ローカルdevサーバー + Playwrightで一連のフロー（初期表示→送信→ユーザー吹き出し即時表示→送信中インジケーター→エラー表示→再読み込みでの履歴復元）を再度通し確認し、全項目パス

**現時点でのプロジェクトの状態**: コード実装・ローカルでの動作確認はすべて完了。MongoDB Atlas への接続、および OpenRouter 経由での実際のAI応答も確認済み（下記追記参照）。残っているのはユーザー自身のアカウントでの外部リソース作業のみ:
  1. ~~MongoDB Atlas で M0 クラスターを作成し、`DATABASE_URL` を Atlas の接続文字列に差し替える~~ → 完了（下記追記参照）
  2. ~~Gemini API キーを発行し設定する~~ → Gemini 直結は断念し **OpenRouter に切り替え済み**（下記追記参照）。無料モデルは共有プールのレート制限に当たることがあるため、`lib/mastra/agents/chat-agent.ts` のモデルを状況に応じて他の `:free` モデルに切り替えられるようにしておくとよい
  3. `deploy/deploy.sh` を使って Google Cloud プロジェクトの準備・Cloud Run へのデプロイ・予算アラート設定を行う（フェーズ8）
  4. デプロイ後、公開URLでの動作確認と MongoDB Atlas の Network Access 設定を行う（フェーズ8）

**追記（MongoDB Atlas 接続確認）**: ユーザーが Atlas M0 クラスターを作成し `.env.local` の `DATABASE_URL` を設定。初回は接続文字列のパスワード部分が `<password>` プレースホルダーのまま（山括弧付き）残っており `bad auth : authentication failed` で失敗したが、実パスワードに置き換えて解消。`prisma db push` でのスキーマ反映、および Session/Message の作成・取得・削除による read/write テストで Atlas への接続を確認済み（フェーズ2のチェックボックスに反映）。

**追記（LLM を Gemini から OpenRouter に変更）**: 詳細な経緯はフェーズ4を参照。要約すると、Google Gemini API の新しいAPIキー形式（`AQ.` プレフィックス）とサードパーティSDKとの間に既知の非互換問題があり接続できなかったため、OpenRouter 経由（`@openrouter/ai-sdk-provider`）に切り替えた。最終的に `openai/gpt-oss-20b:free` で実際のAI応答を確認済み。CLAUDE.md・README.md・`deploy/deploy.sh`・コード内のログメッセージもすべて更新済み。

## 10. コードレビューで判明した追加の残タスク

現在のコード一式を CLAUDE.md の仕様と突き合わせて確認した結果、機能としては一通り動作するものの、以下の点が未対応・改善余地ありと判明した。優先度が高いと考えられる順に記載。

### 信頼性・堅牢性

- [ ] `lib/mastra/agents/chat-agent.ts` が単一の無料モデル（`openai/gpt-oss-20b:free`）決め打ちで、フォールバックが無い
  - フェーズ4の実地検証で、無料モデルは共有プールの一時的なレート制限（429）に頻繁に当たることを確認済み（`z-ai/glm-5.2:free`, `google/gemma-4-31b-it:free` で発生）。現状は 1 モデルが 429 になると即座にユーザーにエラーが返る
  - 対応案: 複数の `:free` モデルを優先順位付きリストで保持し、429 を検知したら次の候補にフォールバックする（あるいは OpenRouter の `models` パラメータ／プロバイダルーティング機能を利用する）
- [ ] `GET /api/messages` にページネーション・件数上限が無い
  - 単一スレッドが無期限に継続する設計のため、長期間使い続けるとレスポンスサイズ・DB容量が際限なく増加する。MongoDB Atlas M0 はストレージ 512MB 上限
  - 対応案: 直近 N 件のみ返す、または `?before=` カーソルベースのページネーションを追加する
- [ ] セッション／会話履歴の保持期間・クリーンアップ機構が無い
  - Cookie の有効期限は1年だが、使われなくなった `Session`/`Message` を DB から削除する仕組み（TTLインデックス等）が無い。長期運用でストレージを圧迫する可能性がある
  - 対応案: MongoDB の TTL インデックスを `updatedAt` 等に設定するか、定期バッチで古いセッションを削除する

### フロントエンド UX

- [ ] `components/chat/message-input.tsx` にサーバー側の4000文字制限に対応する `maxLength` 属性・文字数カウンター表示が無い
  - 現状、ユーザーは4000字を超えて入力・送信して初めて400エラーで気づく。`maxLength={4000}` の付与と、上限に近づいた際の文字数表示を追加すべき

### DevOps・開発運用

- [ ] **Git リポジトリが未初期化**（`git status` が `not a git repository` を返す）
  - `.gitignore` は用意済みだが、実際のバージョン管理が一切行われていない。`git init` の上で最初のコミットを作成することを推奨
- [ ] `.env` と `.env.local` の手動同期が必要な状態になっている
  - Prisma CLI は `.env` のみを自動読み込みし、Next.js は `.env.local` を優先する。開発中も同期忘れによる混乱が複数回発生した。`dotenv-cli` を `package.json` の `db:push` 等のスクリプトに組み込む、または Prisma の設定で読み込み元を明示するなどして一本化を検討
- [ ] 自動テスト・CI が一切無い
  - `package.json` に `test` スクリプトが無く、GitHub Actions 等の CI 設定ファイルも無い。少なくとも Lint/型チェック/ビルドを PR 単位で自動実行する CI の追加が望ましい
- [ ] Dockerfile の `--mount=type=cache` 削除（Cloud Build 対応）後、実際に Cloud Build 上でビルドが成功するかは未確認
  - ローカルの Docker が使えない制約のため、この環境では検証できていない。ユーザー側での `deploy/deploy.sh` 再実行結果を確認すること

### 運用・監視

- [ ] `GET /api/health` が MongoDB への接続を確認しない静的な応答のみ
  - `{"status":"ok"}` を無条件に返すため、DB接続断などの障害時にも 200 を返してしまい、Cloud Run 上での障害切り分けに使いにくい。`prisma.$queryRaw` 等での簡易疎通確認を追加する余地がある
- [ ] 環境変数（`OPENROUTER_API_KEY`, `DATABASE_URL`）が未設定の場合の起動時バリデーションが無い
  - 現状は未設定でもアプリは起動し、該当機能を使った初回リクエスト時に初めてエラーになる。起動時に必須環境変数の有無をチェックし、欠落時に分かりやすいログを出す仕組みがあると運用しやすい