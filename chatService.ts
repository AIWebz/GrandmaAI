import { GRANDMA_TOOLS } from "./tools";
import { TOOL_HANDLERS, ToolInvocationResult } from "./toolHandlers";
import { buildSystemPrompt } from "./systemPrompt";
import { getAiProvider } from "./provider";
import { AiMessage } from "./types";
import { prisma } from "../../db/prisma";
import { startOfDay, endOfDay } from "../../utils/dates";
import { PersonalityStyle } from "../../types/enums";

export interface ChatTurnResult {
  text: string;
  toolInvocations: ToolInvocationResult[];
}

async function loadUserContext(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const memoryFacts = user.memoryOptIn
    ? (await prisma.memoryFact.findMany({ where: { userId } })).map((f) => f.fact)
    : [];
  const todaysTasks = await prisma.task.findMany({
    where: { userId, dueDate: { gte: startOfDay(new Date()), lte: endOfDay(new Date()) } },
    orderBy: { createdAt: "asc" },
  });
  return { user, memoryFacts, todaysTasks };
}

/**
 * Runs one turn of the tool-calling loop: stream model output, and if it
 * requests a tool, execute it against Prisma, feed the result back, and
 * keep going until the model produces a final natural-language answer.
 * `onTextDelta` is called for every streamed text token so the HTTP route
 * can forward it to the client as it arrives (Section 18 streaming req).
 * Works against whichever AiProvider is configured (Anthropic or the
 * local Ollama backend - see docs/ARCHITECTURE.md).
 */
export async function runChatTurn(
  userId: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  onTextDelta: (delta: string) => void
): Promise<ChatTurnResult> {
  const provider = getAiProvider();
  const { user, memoryFacts, todaysTasks } = await loadUserContext(userId);
  const system = buildSystemPrompt({
    preferredName: user.preferredName,
    personalityStyle: user.personalityStyle as PersonalityStyle,
    memoryFacts,
    todaysTasks: todaysTasks.map((t) => ({ title: t.title, completed: t.completed })),
  });

  const messages: AiMessage[] = [
    ...history.map((h): AiMessage => (h.role === "user" ? { role: "user", content: h.content } : { role: "assistant", text: h.content })),
    { role: "user", content: userMessage },
  ];

  const toolInvocations: ToolInvocationResult[] = [];
  let finalText = "";

  for (let iteration = 0; iteration < 5; iteration++) {
    const { assistantMessage, stopReason } = await provider.chatTurn({
      system,
      messages,
      tools: GRANDMA_TOOLS,
      onTextDelta: (delta) => {
        finalText += delta;
        onTextDelta(delta);
      },
    });
    messages.push(assistantMessage);

    if (stopReason !== "tool_use" || !assistantMessage.toolCalls?.length) break;

    for (const call of assistantMessage.toolCalls) {
      const handler = TOOL_HANDLERS[call.name];
      const invocation = handler
        ? await handler(userId, call.input)
        : { tool: call.name, input: call.input, result: { error: "Unknown tool" } };
      toolInvocations.push(invocation);
      messages.push({ role: "tool_result", toolCallId: call.id, toolName: call.name, content: JSON.stringify(invocation.result) });
    }
    // Loop again so the model can narrate a confirmation referencing the tool result.
  }

  await prisma.chatMessage.create({ data: { userId, role: "USER", content: userMessage } });
  await prisma.chatMessage.create({
    data: { userId, role: "ASSISTANT", content: finalText, toolInvocations: JSON.stringify(toolInvocations) },
  });

  return { text: finalText, toolInvocations };
}
