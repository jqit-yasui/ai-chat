"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/chat-types";

type Props = {
  messages: ChatMessage[];
  isLoadingHistory: boolean;
  isSending: boolean;
  streamingText: string | null;
};

export function MessageList({ messages, isLoadingHistory, isSending, streamingText }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending, streamingText]);

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
          <div
            className={`flex max-w-[80%] flex-col gap-2 rounded-2xl px-4 py-2 text-sm ${
              message.role === "user"
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            }`}
          >
            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {message.images.map((src, index) => (
                  // eslint-disable-next-line @next/next/no-img-element -- 添付画像（data URL）のプレビュー表示
                  <img
                    key={index}
                    src={src}
                    alt=""
                    className="max-h-48 max-w-full rounded-lg object-cover"
                  />
                ))}
              </div>
            )}
            {message.content && (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )}
          </div>
        </div>
      ))}
      {isSending && streamingText === null && (
        <div className="flex justify-start">
          <p className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            AIが考え中...
          </p>
        </div>
      )}
      {streamingText !== null && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            <p className="whitespace-pre-wrap break-words">{streamingText}</p>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
