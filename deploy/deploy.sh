#!/usr/bin/env bash
# Google Cloud Run へのデプロイ用スクリプト。
#
# 前提:
#   - ローカルに Docker は不要（Cloud Build 経由でリモートビルドするため）
#   - `gcloud` CLI がインストール・認証済みであること（未認証なら `gcloud auth login`）
#   - MongoDB Atlas の接続文字列（M0 無料クラスター）が取得済みであること
#   - OpenRouter（https://openrouter.ai/keys）で API キーが発行済みであること
#
# 使い方:
#   1. 下記の変数を自分の環境に合わせて書き換える（PROJECT_ID, BILLING_ACCOUNT_ID など）
#   2. OPENROUTER_API_KEY, DATABASE_URL を環境変数として渡して実行する
#        OPENROUTER_API_KEY="sk-or-v1-..." DATABASE_URL="mongodb+srv://..." ./deploy/deploy.sh
#
# このスクリプトは実行しません（ai-chat プロジェクト側のエージェントはGoogle Cloud
# の認証情報を持っていないため）。ユーザー自身の端末・アカウントで実行してください。

set -euo pipefail

# ===== 環境ごとに書き換える変数 =====
PROJECT_ID="your-gcp-project-id"          # 例: ai-chat-123456
REGION="asia-northeast1"                  # 東京リージョン。他リージョンでも可
SERVICE_NAME="ai-chat"
REPOSITORY="ai-chat"
BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX" # gcloud billing accounts list で確認
BUDGET_AMOUNT_USD="1"                     # 予算アラートのしきい値（誤課金検知用）
# ===================================

: "${OPENROUTER_API_KEY:?環境変数 OPENROUTER_API_KEY を設定してください（OpenRouter で発行したキー）}"
: "${DATABASE_URL:?環境変数 DATABASE_URL を設定してください（MongoDB Atlas の接続文字列）}"

if [ "$PROJECT_ID" = "your-gcp-project-id" ]; then
  echo "エラー: deploy.sh 冒頭の PROJECT_ID / BILLING_ACCOUNT_ID などを実際の値に書き換えてから実行してください。" >&2
  exit 1
fi

echo "==> プロジェクトを設定: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

echo "==> 必要な API を有効化"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

echo "==> Artifact Registry リポジトリを作成（既存ならスキップされます）"
gcloud artifacts repositories create "${REPOSITORY}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="ai-chat コンテナイメージ" \
  || echo "リポジトリは既に存在する可能性があります。続行します。"

echo "==> Artifact Registry のクリーンアップポリシーを設定（無料枠 0.5GB 超過防止）"
gcloud artifacts repositories set-cleanup-policies "${REPOSITORY}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --policy=deploy/artifact-registry-cleanup-policy.json \
  --no-dry-run

echo "==> Cloud Run へソースからデプロイ（Cloud Build でリモートビルドするためローカル Docker 不要）"
# --source .                 : リポジトリ直下の Dockerfile を Cloud Build がビルドして Artifact Registry に push
# --min-instances=0          : 常時起動させない（課金防止。コールドスタートは許容）
# --cpu-throttling           : リクエスト処理中のみ CPU を割り当てる（デフォルト値だが明示）
# --allow-unauthenticated    : 認証なしで誰でもアクセス可能にする（CLAUDE.md の仕様どおり認証なし運用）
# --set-env-vars             : Secret Manager は使わず環境変数に直接設定
gcloud run deploy "${SERVICE_NAME}" \
  --source=. \
  --region="${REGION}" \
  --platform=managed \
  --min-instances=0 \
  --cpu-throttling \
  --allow-unauthenticated \
  --set-env-vars="OPENROUTER_API_KEY=${OPENROUTER_API_KEY},DATABASE_URL=${DATABASE_URL}"

echo "==> 予算アラートを設定（${BUDGET_AMOUNT_USD} USD、誤課金の早期検知用）"
gcloud billing budgets create \
  --billing-account="${BILLING_ACCOUNT_ID}" \
  --display-name="${SERVICE_NAME}-budget-alert" \
  --budget-amount="${BUDGET_AMOUNT_USD}USD" \
  --filter-projects="projects/${PROJECT_ID}" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=1.0 \
  || echo "予算アラートの作成に失敗しました（billing account の権限を確認してください）。手動で Cloud Console から設定してください。"

echo "==> デプロイ完了。公開URLを表示します"
gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.url)"
