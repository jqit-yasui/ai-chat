# syntax=docker/dockerfile:1
ARG NODE_VERSION=22-slim

# ============================================
# Stage 1: 依存関係のインストール
# ============================================
FROM node:${NODE_VERSION} AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
# postinstall で `prisma generate` が走るため、Prisma Client 生成に必要な schema も先にコピーする
COPY prisma ./prisma

RUN npm ci --no-audit --no-fund

# ============================================
# Stage 2: Next.js アプリケーションのビルド（standalone 出力）
# ============================================
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ============================================
# Stage 3: 実行用の最小イメージ
# ============================================
FROM node:${NODE_VERSION} AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run は $PORT を注入するが、ローカル実行時のデフォルトとして 3000 を設定
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

CMD ["node", "server.js"]
