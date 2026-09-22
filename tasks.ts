import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { startOfDay, endOfDay } from "../utils/dates";

export const tasksRouter = Router();

const CATEGORY = z.enum(["CLEANING", "LAUNDRY", "KITCHEN", "YARD", "SHOPPING", "PETS", "HOUSEHOLD", "OTHER"]);
const RECURRENCE = z.enum(["NONE", "DAILY", "WEEKLY"]);

tasksRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const { date, category } = req.query as { date?: string; category?: string };
  const where: any = { userId: req.userId };
  if (date) {
    const d = new Date(date);
    where.dueDate = { gte: startOfDay(d), lte: endOfDay(d) };
  }
  if (category) where.category = category;
  const tasks = await prisma.task.findMany({ where, orderBy: { createdAt: "asc" } });
  res.json({ tasks });
});

tasksRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    title: z.string().min(1),
    category: CATEGORY.default("OTHER"),
    notes: z.string().optional(),
    dueDate: z.string().optional(),
    isFixed: z.boolean().default(false),
    recurrence: RECURRENCE.default("NONE"),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid task" });
  const task = await prisma.task.create({
    data: { userId: req.userId!, ...parse.data, dueDate: parse.data.dueDate ? new Date(parse.data.dueDate) : new Date() },
  });
  res.status(201).json({ task });
});

tasksRouter.patch("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!task) return res.status(404).json({ error: "Not found" });

  const schema = z.object({
    title: z.string().optional(),
    category: CATEGORY.optional(),
    notes: z.string().optional(),
    dueDate: z.string().optional(),
    completed: z.boolean().optional(),
    recurrence: RECURRENCE.optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid update" });

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      ...parse.data,
      dueDate: parse.data.dueDate ? new Date(parse.data.dueDate) : undefined,
      completedAt: parse.data.completed === true ? new Date() : parse.data.completed === false ? null : undefined,
    },
  });
  res.json({ task: updated });
});

tasksRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!task) return res.status(404).json({ error: "Not found" });
  await prisma.task.delete({ where: { id: task.id } });
  res.json({ ok: true });
});

/** Rolls completed recurring tasks forward - call once daily (cron) or lazily on read. */
tasksRouter.post("/reset-recurring", requireAuth, async (req: AuthedRequest, res) => {
  const stale = await prisma.task.findMany({
    where: { userId: req.userId, completed: true, recurrence: { not: "NONE" }, dueDate: { lt: startOfDay(new Date()) } },
  });
  const updated = await Promise.all(
    stale.map((t) =>
      prisma.task.update({ where: { id: t.id }, data: { completed: false, completedAt: null, dueDate: new Date() } })
    )
  );
  res.json({ resetCount: updated.length });
});

export const remindersRouter = Router();

remindersRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const reminders = await prisma.reminder.findMany({ where: { userId: req.userId }, orderBy: { remindAt: "asc" } });
  res.json({ reminders });
});

remindersRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ title: z.string().min(1), remindAt: z.string() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid reminder" });
  const reminder = await prisma.reminder.create({ data: { userId: req.userId!, title: parse.data.title, remindAt: new Date(parse.data.remindAt) } });
  res.status(201).json({ reminder });
});

remindersRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const reminder = await prisma.reminder.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!reminder) return res.status(404).json({ error: "Not found" });
  await prisma.reminder.delete({ where: { id: reminder.id } });
  res.json({ ok: true });
});
