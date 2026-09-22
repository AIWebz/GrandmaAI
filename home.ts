import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { generateHomeGreeting } from "../services/ai/greetingService";
import { startOfDay, endOfDay } from "../utils/dates";

export const homeRouter = Router();

homeRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  const tasks = await prisma.task.findMany({
    where: { userId: req.userId, dueDate: { gte: startOfDay(new Date()), lte: endOfDay(new Date()) } },
    orderBy: { createdAt: "asc" },
  });

  const greeting = await generateHomeGreeting(req.userId!);
  const completed = tasks.filter((t) => t.completed).length;

  res.json({
    preferredName: user.preferredName,
    greeting,
    tasks,
    progress: { completed, total: tasks.length },
  });
});
