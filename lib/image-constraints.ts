// メッセージに添付できる画像の制限値。フロントエンド（バリデーション）と
// API（zodスキーマ）の両方から参照する共通定義。
export const MAX_IMAGES_PER_MESSAGE = 3;

// 添付前（デコード後）のファイルサイズ上限。MongoDB Atlas M0 の
// ストレージ上限（512MB）を踏まえ、1メッセージあたりの肥大化を抑える。
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const DATA_URL_RE = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+=?=?)$/;

// "data:image/png;base64,...." 形式のURLを検証し、MIMEタイプと
// 概算のバイト数（デコード前提）を返す。不正な場合は null。
export function parseImageDataUrl(
  value: string,
): { mimeType: string; approxBytes: number } | null {
  const match = value.match(DATA_URL_RE);
  if (!match) return null;

  const [, mimeType, base64] = match;
  const approxBytes = Math.floor((base64.length * 3) / 4);
  return { mimeType, approxBytes };
}

export function isAllowedImageMimeType(mimeType: string): mimeType is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}
