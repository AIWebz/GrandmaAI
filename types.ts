/**
 * Provider-agnostic shapes so chatService/recipeService/greetingService/
 * recipeVision don't depend on any one vendor's SDK. Two backends
 * implement `AiProvider`: `anthropicProvider` (hosted, needs an API key)
 * and `ollamaProvider` (local, no key - see docs/ARCHITECTURE.md).
 */

export interface AiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  input: any;
}

export type AiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls?: AiToolCall[] }
  | { role: "tool_result"; toolCallId: string; toolName: string; content: string };

export interface ChatTurnParams {
  system: string;
  messages: AiMessage[];
  tools: AiTool[];
  onTextDelta: (delta: string) => void;
}

export interface ChatTurnResult {
  assistantMessage: Extract<AiMessage, { role: "assistant" }>;
  stopReason: "tool_use" | "end";
}

export interface AiProvider {
  /** One model turn in the tool-calling loop; the loop itself lives in chatService.ts. */
  chatTurn(params: ChatTurnParams): Promise<ChatTurnResult>;
  /** Plain text generation, no tools (greetings, contextual recipe Q&A). */
  generateText(system: string, prompt: string, maxTokens?: number): Promise<string>;
  /** Forced structured JSON output matching `schema` (a JSON Schema object) - used for recipe generation. */
  generateStructured<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T>;
  /** Structured JSON output from an image, matching `schema` (handwriting digitization). */
  generateStructuredFromImage<T>(system: string, prompt: string, imageBase64: string, mediaType: string, schema: Record<string, unknown>): Promise<T>;
}
