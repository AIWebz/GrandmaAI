import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePlus, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { isPlusUser } from "../utils/subscriptionTier";

export const memoryRouter = Router();

memoryRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  const facts = await prisma.memoryFact.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } });
  res.json({ memoryOptIn: user.memoryOptIn, facts });
});

/**
 * Explicit, plain-language opt-in/out (Section 10) - not buried in
 * settings. Long-term memory is a Grandma+ feature, but turning it OFF is
 * always allowed regardless of tier - never block someone from opting out.
 */
memoryRouter.post("/opt-in", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ enabled: z.boolean() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid request" });
  if (parse.data.enabled && !(await isPlusUser(req.userId!))) {
    return res.status(403).json({ error: "PLUS_REQUIRED", message: "Long-term memory is a Grandma+ feature." });
  }
  await prisma.user.update({ where: { id: req.userId }, data: { memoryOptIn: parse.data.enabled } });
  res.json({ memoryOptIn: parse.data.enabled });
});

const ALLOWED_CATEGORIES = ["favorite_food", "disliked_food", "dietary_restriction", "favorite_recipe", "routine", "skill_level", "schedule", "other"];

memoryRouter.post("/", requireAuth, requirePlus, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (!user.memoryOptIn) return res.status(403).json({ error: "MEMORY_DISABLED", message: "Turn on memory first to save this." });
  const schema = z.object({ category: z.enum(ALLOWED_CATEGORIES as [string, ...string[]]), fact: z.string().min(1) });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid fact" });
  const fact = await prisma.memoryFact.create({ data: { userId: req.userId!, ...parse.data } });
  res.status(201).json({ fact });
});

memoryRouter.patch("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const fact = await prisma.memoryFact.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!fact) return res.status(404).json({ error: "Not found" });
  const schema = z.object({ fact: z.string().min(1) });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid update" });
  const updated = await prisma.memoryFact.update({ where: { id: fact.id }, data: parse.data });
  res.json({ fact: updated });
});

memoryRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const fact = await prisma.memoryFact.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!fact) return res.status(404).json({ error: "Not found" });
  await prisma.memoryFact.delete({ where: { id: fact.id } });
  res.json({ ok: true });
});

/** "Forget everything" - a single control per Section 10. */
memoryRouter.delete("/", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.memoryFact.deleteMany({ where: { userId: req.userId } });
  res.json({ ok: true });
});
