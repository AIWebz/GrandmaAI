import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { startOfDay, endOfDay } from "../utils/dates";

export const scheduleRouter = Router();

scheduleRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const start = from ? startOfDay(new Date(from)) : startOfDay(new Date());
  const end = to ? endOfDay(new Date(to)) : endOfDay(new Date());
  const events = await prisma.scheduleEvent.findMany({
    where: { userId: req.userId, startTime: { gte: start, lte: end } },
    orderBy: { startTime: "asc" },
  });
  res.json({ events });
});

scheduleRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ title: z.string().min(1), startTime: z.string(), endTime: z.string().optional(), isFixed: z.boolean().default(false) });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid event" });
  const event = await prisma.scheduleEvent.create({
    data: { userId: req.userId!, title: parse.data.title, startTime: new Date(parse.data.startTime), endTime: parse.data.endTime ? new Date(parse.data.endTime) : null, isFixed: parse.data.isFixed },
  });
  res.status(201).json({ event });
});

/** Reschedule a single item (drag-to-reschedule on the client, or "move X to tomorrow" from chat). */
scheduleRouter.patch("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const event = await prisma.scheduleEvent.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!event) return res.status(404).json({ error: "Not found" });
  if (event.isFixed) return res.status(409).json({ error: "FIXED", message: "This is marked fixed and won't move automatically." });

  const schema = z.object({ startTime: z.string().optional(), endTime: z.string().optional(), title: z.string().optional(), isFixed: z.boolean().optional() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid update" });
  const updated = await prisma.scheduleEvent.update({
    where: { id: event.id },
    data: { ...parse.data, startTime: parse.data.startTime ? new Date(parse.data.startTime) : undefined, endTime: parse.data.endTime ? new Date(parse.data.endTime) : undefined },
  });
  res.json({ event: updated });
});

scheduleRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const event = await prisma.scheduleEvent.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!event) return res.status(404).json({ error: "Not found" });
  await prisma.scheduleEvent.delete({ where: { id: event.id } });
  res.json({ ok: true });
});
