import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../anthropicClient";
import { env } from "../../../config/env";
import { AiProvider, AiMessage, AiTool, ChatTurnParams, ChatTurnResult } from "../types";

type ContentBlockParam = Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam;

function toAnthropicMessages(messages: AiMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      result.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const content: ContentBlockParam[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const call of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      result.push({ role: "assistant", content });
    } else {
      // tool_result - Anthropic expects these grouped as a single "user" turn.
      const last = result[result.length - 1];
      const block: Anthropic.ToolResultBlockParam = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
        (last.content as Anthropic.ToolResultBlockParam[]).push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
    }
  }
  return result;
}

export const anthropicProvider: AiProvider = {
  async chatTurn({ system, messages, tools, onTextDelta }: ChatTurnParams): Promise<ChatTurnResult> {
    const stream = anthropic.messages.stream({
      model: env.anthropicModel,
      max_tokens: 1024,
      system,
      messages: toAnthropicMessages(messages),
      tools: tools as Anthropic.Tool[],
    });
    stream.on("text", onTextDelta);
    const finalMessage = await stream.finalMessage();

    let text = "";
    const toolCalls = [];
    for (const block of finalMessage.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }

    return {
      assistantMessage: { role: "assistant", text, toolCalls: toolCalls.length ? toolCalls : undefined },
      stopReason: finalMessage.stop_reason === "tool_use" ? "tool_use" : "end",
    };
  },

  async generateText(system, prompt, maxTokens = 400) {
    const message = await anthropic.messages.create({
      model: env.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text.trim() : "";
  },

  async generateStructured<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
    const tool: Anthropic.Tool = {
      name: "emit_result",
      description: "Return the result in the exact structure requested.",
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
    const message = await anthropic.messages.create({
      model: env.anthropicModel,
      max_tokens: 1500,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_result" },
      messages: [{ role: "user", content: prompt }],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return structured output");
    return toolUse.input as T;
  },

  async generateStructuredFromImage<T>(system: string, prompt: string, imageBase64: string, mediaType: string, schema: Record<string, unknown>): Promise<T> {
    const tool: Anthropic.Tool = {
      name: "emit_result",
      description: "Return the result in the exact structure requested.",
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
    const message = await anthropic.messages.create({
      model: env.anthropicVisionModel,
      max_tokens: 1500,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_result" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as any, data: imageBase64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("Model did not return structured output");
    return toolUse.input as T;
  },
};
