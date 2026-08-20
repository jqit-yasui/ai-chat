export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  createdAt: string;
};
