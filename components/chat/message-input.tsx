"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_BYTES,
} from "@/lib/image-constraints";

type Props = {
  onSend: (text: string, images: string[]) => void;
  disabled: boolean;
};

type AttachedImage = {
  id: string;
  dataUrl: string;
  name: string;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("画像の読み込みに失敗しました。"));
    reader.readAsDataURL(file);
  });
}

const MAX_IMAGE_MB = MAX_IMAGE_BYTES / (1024 * 1024);

export function MessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    let error: string | null = null;
    const accepted: AttachedImage[] = [];

    for (const file of list) {
      if (images.length + accepted.length >= MAX_IMAGES_PER_MESSAGE) {
        error = `画像は${MAX_IMAGES_PER_MESSAGE}枚まで添付できます。`;
        break;
      }
      if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
        error = "対応していないファイル形式です（jpg / png / webp / gif のみ）。";
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        error = `画像は${MAX_IMAGE_MB}MB以下にしてください。`;
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        accepted.push({ id: `${Date.now()}-${file.name}-${accepted.length}`, dataUrl, name: file.name });
      } catch {
        error = "画像の読み込みに失敗しました。";
      }
    }

    setImageError(error);
    if (accepted.length > 0) {
      setImages((prev) => [...prev, ...accepted]);
    }
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    e.target.value = "";
  }

  function handleDrop(e: DragEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e: DragEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }

  function submit() {
    const trimmed = value.trim();
    if ((!trimmed && images.length === 0) || disabled) return;
    onSend(
      trimmed,
      images.map((img) => img.dataUrl),
    );
    setValue("");
    setImages([]);
    setImageError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // 日本語入力の変換確定 Enter で誤送信しないよう isComposing を確認する
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const canAddMoreImages = images.length < MAX_IMAGES_PER_MESSAGE;

  return (
    <form
      onSubmit={handleSubmit}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`flex flex-col gap-2 border-t py-4 transition-colors dark:border-white/[.145] ${
        isDragging ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-black/[.08]"
      }`}
    >
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img) => (
            <div key={img.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- ユーザー添付画像のプレビュー（動的なdata URL） */}
              <img
                src={img.dataUrl}
                alt={img.name}
                className="h-16 w-16 rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(img.id)}
                aria-label={`${img.name}を削除`}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-white hover:bg-zinc-700"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {imageError && <p className="text-xs text-red-600 dark:text-red-400">{imageError}</p>}

      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
          multiple
          onChange={handleFileInputChange}
          disabled={disabled || !canAddMoreImages}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || !canAddMoreImages}
          aria-label="画像を添付"
          title="画像を添付"
          className="rounded-full border border-black/[.08] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145]"
        >
          📎
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力..."
          disabled={disabled}
          aria-label="メッセージ入力"
          className="flex-1 rounded-full border border-black/[.08] bg-white px-4 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-white/[.145] dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={disabled || (!value.trim() && images.length === 0)}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          送信
        </button>
      </div>
    </form>
  );
}
