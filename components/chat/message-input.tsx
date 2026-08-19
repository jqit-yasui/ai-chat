"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

type Props = {
  onSend: (text: string) => void;
  disabled: boolean;
};

export function MessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
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

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-2 border-t border-black/[.08] py-4 dark:border-white/[.145]"
    >
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
        disabled={disabled || !value.trim()}
        className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        送信
      </button>
    </form>
  );
}
