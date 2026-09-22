import fetch from "node-fetch";
import { env } from "../../../config/env";
import { AiProvider, AiMessage, AiTool, ChatTurnParams, ChatTurnResult, AiToolCall } from "../types";

/**
 * Local, no-API-key AI backend via Ollama (https://ollama.com), selected
 * with AI_PROVIDER=ollama. Needs Ollama installed and running wherever the
 * server runs, with a tool-calling-capable model pulled (default
 * `llama3.1`) and, for handwriting digitization, a vision model pulled
 * (default `llava`). This sandbox can't reach ollama.com to install/pull
 * models or exercise this against a live server - see docs/ARCHITECTURE.md
 * for setup steps and what was/wasn't testable here.
 */

interface OllamaToolCall {
  function: { name: string; arguments: any };
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
}

let toolCallCounter = 0;
const nextToolCallId = () => `ollama_call_${Date.now()}_${toolCallCounter++}`;

function toOllamaTools(tools: AiTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function toOllamaMessages(system: string, messages: AiMessage[]): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      result.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      result.push({
        role: "assistant",
        content: m.text,
        tool_calls: m.toolCalls?.map((c) => ({ function: { name: c.name, arguments: c.input } })),
      });
    } else {
      result.push({ role: "tool", content: m.content });
    }
  }
  return result;
}

async function ollamaChat(body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${env.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama request failed (${response.status}): ${text || response.statusText}`);
  }
  return response.json();
}

function extractJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Some local models wrap JSON in prose or a code fence despite format:"json" - salvage the first {...} block.
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("Local model did not return valid JSON");
  }
}

export const ollamaProvider: AiProvider = {
  async chatTurn({ system, messages, tools, onTextDelta }: ChatTurnParams): Promise<ChatTurnResult> {
    const response = await fetch(`${env.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.ollamaModel,
        messages: toOllamaMessages(system, messages),
        tools: toOllamaTools(tools),
        stream: true,
      }),
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama request failed (${response.status}): ${text || response.statusText}`);
    }

    let text = "";
    let toolCalls: AiToolCall[] = [];
    let buffer = "";

    for await (const chunk of response.body as any as AsyncIterable<Buffer>) {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        const delta: string = event.message?.content ?? "";
        if (delta) {
          text += delta;
          onTextDelta(delta);
        }
        if (event.message?.tool_calls?.length) {
          toolCalls = event.message.tool_calls.map((c: OllamaToolCall) => ({
            id: nextToolCallId(),
            name: c.function.name,
            input: c.function.arguments,
          }));
        }
      }
    }

    return {
      assistantMessage: { role: "assistant", text, toolCalls: toolCalls.length ? toolCalls : undefined },
      stopReason: toolCalls.length ? "tool_use" : "end",
    };
  },

  async generateText(system, prompt, maxTokens = 400) {
    const json = await ollamaChat({
      model: env.ollamaModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      stream: false,
      options: { num_predict: maxTokens },
    });
    return (json.message?.content ?? "").trim();
  },

  async generateStructured<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
    const json = await ollamaChat({
      model: env.ollamaModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      format: schema,
      stream: false,
    });
    return extractJson<T>(json.message?.content ?? "");
  },

  async generateStructuredFromImage<T>(system: string, prompt: string, imageBase64: string, _mediaType: string, schema: Record<string, unknown>): Promise<T> {
    const json = await ollamaChat({
      model: env.ollamaVisionModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt, images: [imageBase64] },
      ],
      format: schema,
      stream: false,
    });
    return extractJson<T>(json.message?.content ?? "");
  },
};
