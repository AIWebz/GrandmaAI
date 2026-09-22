import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireFullAccount, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { runNotificationTick } from "../services/notifications/scheduler";

export const notificationsRouter = Router();

notificationsRouter.get("/preferences", requireAuth, async (req: AuthedRequest, res) => {
  const pref = await prisma.notificationPreference.findUnique({ where: { userId: req.userId } });
  res.json({ preferences: pref });
});

notificationsRouter.patch("/preferences", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    frequency: z.enum(["OFF", "LOW", "NORMAL"]).optional(),
    taskReminders: z.boolean().optional(),
    mealTimePrompts: z.boolean().optional(),
    encouragement: z.boolean().optional(),
    quietHoursStart: z.string().optional(),
    quietHoursEnd: z.string().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid preferences" });
  const pref = await prisma.notificationPreference.upsert({
    where: { userId: req.userId! },
    update: parse.data,
    create: { userId: req.userId!, ...parse.data },
  });
  res.json({ preferences: pref });
});

/** Registering a push token is a durable-identity action -> requires a full account (see docs/ARCHITECTURE.md). */
notificationsRouter.post("/register-token", requireAuth, requireFullAccount, async (req: AuthedRequest, res) => {
  const schema = z.object({ pushToken: z.string().min(1) });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "pushToken required" });
  const pref = await prisma.notificationPreference.upsert({
    where: { userId: req.userId! },
    update: { pushToken: parse.data.pushToken },
    create: { userId: req.userId!, pushToken: parse.data.pushToken },
  });
  res.json({ preferences: pref });
});

/** Cron entry point - wire this to a scheduled job (e.g. every 15 minutes). */
notificationsRouter.post("/dispatch-tick", async (_req, res) => {
  const result = await runNotificationTick();
  res.json(result);
});
