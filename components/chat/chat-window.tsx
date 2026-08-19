"use client";

import { useEffect, useState } from "react";
import { MessageList } from "@/components/chat/message-list";
import { MessageInput } from "@/components/chat/message-input";
import type { ChatMessage } from "@/lib/chat-types";

export function ChatWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/messages");
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setMessages(data.messages);
      } catch {
        if (!cancelled) {
          setError("会話履歴の取得に失敗しました。ページを再読み込みしてください。");
        }
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSend(text: string) {
    setError(null);

    const optimisticUserMessage: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMessage]);
    setIsSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "応答の取得に失敗しました。",
        );
      }

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUserMessage.id),
        data.userMessage,
        data.assistantMessage,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "応答の取得に失敗しました。");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4">
      <header className="border-b border-black/[.08] py-4 dark:border-white/[.145]">
        <h1 className="text-lg font-semibold">AIチャット</h1>
      </header>

      <MessageList messages={messages} isLoadingHistory={isLoadingHistory} isSending={isSending} />

      {error && (
        <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <MessageInput onSend={handleSend} disabled={isSending} />
    </div>
  );
}
