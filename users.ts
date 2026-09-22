import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";

export const usersRouter = Router();

const ONBOARDING_SCHEMA = z.object({
  preferredName: z.string().min(1).max(60).optional(),
  interests: z.array(z.enum(["COOKING", "CHORES", "PLANNING", "GROCERIES", "REMINDERS", "ENCOURAGEMENT", "EVERYTHING"])).optional(),
  personalityStyle: z.enum(["WARM", "FUNNY", "CALM", "PRACTICAL"]).optional(),
  onboardingCompleted: z.boolean().optional(),
});

usersRouter.patch("/me", requireAuth, async (req: AuthedRequest, res) => {
  const parse = ONBOARDING_SCHEMA.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid profile data" });
  const data: any = { ...parse.data };
  if (data.interests) data.interests = JSON.stringify(data.interests);

  const user = await prisma.user.update({ where: { id: req.userId }, data });
  res.json({ user: { ...user, interests: JSON.parse(user.interests) } });
});

usersRouter.get("/me/export", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const [user, tasks, reminders, recipes, cookbook, groceryLists, schedule, memory, chat] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.task.findMany({ where: { userId } }),
    prisma.reminder.findMany({ where: { userId } }),
    prisma.recipe.findMany({ where: { userId } }),
    prisma.familyCookbookRecipe.findMany({ where: { userId } }),
    prisma.groceryList.findMany({ where: { userId }, include: { items: true } }),
    prisma.scheduleEvent.findMany({ where: { userId } }),
    prisma.memoryFact.findMany({ where: { userId } }),
    prisma.chatMessage.findMany({ where: { userId } }),
  ]);
  res.setHeader("Content-Disposition", "attachment; filename=grandma-ai-export.json");
  res.json({ user, tasks, reminders, recipes, cookbook, groceryLists, schedule, memory, chat });
});

usersRouter.delete("/me", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.user.delete({ where: { id: req.userId } }); // cascades to all owned data
  res.json({ ok: true });
});
