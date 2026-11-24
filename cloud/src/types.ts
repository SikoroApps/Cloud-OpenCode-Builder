export type Role = "user" | "assistant";

export interface ChatMessage {
  id: number;
  userId: string;
  sessionKey: string;
  role: Role;
  content: string;
  model: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ProviderKind = "opencode" | "openrouter";

export interface FallbackCandidate {
  id: string;
  kind: ProviderKind;
  providerID: string;
  modelID: string;
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiAttemptResult {
  model: string;
  content: string;
  finishReason: string;
}

export interface AiRunError {
  message: string;
  status?: number;
  kind?: string;
  attempts: AiAttemptResult[];
}

export interface AiRunResult {
  model: string;
  content: string;
  finishReason: string;
  attempts: AiAttemptResult[];
}
