import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { runChatTurn } from "../services/ai/chatService";
import { answerRecipeQuestion } from "../services/ai/recipeService";
import { getUsageStatus, incrementUsage, grantRewardedUnlock } from "../utils/usageCap";
import { prisma } from "../db/prisma";
import { isAiConfigured } from "../services/ai/provider";

export const chatRouter = Router();

chatRouter.get("/usage", requireAuth, async (req: AuthedRequest, res) => {
  const status = await getUsageStatus(req.userId!);
  res.json(status);
});

/** Called after a rewarded ad's onEarnedReward fires (Section 15 "rewarded ads for extra features"). */
chatRouter.post("/usage/reward", requireAuth, async (req: AuthedRequest, res) => {
  const { granted, status } = await grantRewardedUnlock(req.userId!);
  if (!granted) {
    return res.status(429).json({ error: "REWARD_CAP_REACHED", message: "You've used today's bonus chats from ads.", status });
  }
  res.json({ granted, status });
});

chatRouter.get("/history", requireAuth, async (req: AuthedRequest, res) => {
  const messages = await prisma.chatMessage.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  res.json({ messages: messages.map((m) => ({ ...m, toolInvocations: JSON.parse(m.toolInvocations) })) });
});

/**
 * SSE streaming chat endpoint. Streams text token-by-token as required by
 * Section 18, then emits a final event carrying the tool invocations so the
 * client can render inline cards.
 */
chatRouter.post("/message", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    message: z.string().min(1).max(2000),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid request" });

  const usage = await getUsageStatus(req.userId!);
  if (usage.atCap) {
    return res.status(402).json({ error: "USAGE_CAP_REACHED", usage, message: "You've used today's free Grandma chats - Grandma+ gives you unlimited." });
  }

  if (!isAiConfigured()) {
    return res.status(503).json({
      error: "AI_UNAVAILABLE",
      message: "I'm having a little trouble hearing you right now - try again in a moment?",
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await runChatTurn(req.userId!, parse.data.history, parse.data.message, (delta) => {
      send("delta", { text: delta });
    });
    await incrementUsage(req.userId!);
    send("done", { text: result.text, toolInvocations: result.toolInvocations });
  } catch (err: any) {
    send("error", { message: "I'm having a little trouble hearing you right now - try again in a moment?" });
  } finally {
    res.end();
  }
});

/** Contextual Q&A while viewing/cooking a recipe (Section 5). */
chatRouter.post("/recipe-question", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    recipeName: z.string(),
    ingredients: z.array(z.object({ name: z.string(), quantity: z.string().optional(), unit: z.string().optional() })),
    currentStepText: z.string().optional(),
    question: z.string(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid request" });

  if (!isAiConfigured()) {
    return res.status(503).json({ error: "AI_UNAVAILABLE", message: "I'm having a little trouble hearing you right now - try again in a moment?" });
  }

  try {
    const answer = await answerRecipeQuestion(parse.data);
    res.json({ answer });
  } catch {
    res.status(503).json({ error: "AI_UNAVAILABLE", message: "I'm having a little trouble hearing you right now - try again in a moment?" });
  }
});
