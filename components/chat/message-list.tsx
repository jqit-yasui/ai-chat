"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/chat-types";

type Props = {
  messages: ChatMessage[];
  isLoadingHistory: boolean;
  isSending: boolean;
};

export function MessageList({ messages, isLoadingHistory, isSending }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto py-4">
      {isLoadingHistory && (
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">読み込み中...</p>
      )}
      {!isLoadingHistory && messages.length === 0 && (
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          メッセージを送ってAIとの会話を始めましょう。
        </p>
      )}
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <p
            className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm ${
              message.role === "user"
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            }`}
          >
            {message.content}
          </p>
        </div>
      ))}
      {isSending && (
        <div className="flex justify-start">
          <p className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            AIが入力中...
          </p>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
