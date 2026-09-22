import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireFullAccount, requirePlus, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";

export const groceryListsRouter = Router();

// Reading, checking off, and deleting existing lists always stays available
// (grandfathered) even for a free/downgraded user - only *generating* new
// lists/items is the Grandma+ feature (Section: "grocery shopping list generation").
groceryListsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const lists = await prisma.groceryList.findMany({ where: { userId: req.userId }, include: { items: true }, orderBy: { createdAt: "desc" } });
  res.json({ groceryLists: lists });
});

groceryListsRouter.post("/", requireAuth, requireFullAccount, requirePlus, async (req: AuthedRequest, res) => {
  const schema = z.object({
    title: z.string().default("Grocery List"),
    items: z.array(z.object({ name: z.string(), quantity: z.string().optional(), storeCategory: z.string().default("other") })).default([]),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid list" });
  const list = await prisma.groceryList.create({
    data: { userId: req.userId!, title: parse.data.title, items: { create: parse.data.items } },
    include: { items: true },
  });
  res.status(201).json({ groceryList: list });
});

groceryListsRouter.post("/:id/items", requireAuth, requireFullAccount, requirePlus, async (req: AuthedRequest, res) => {
  const list = await prisma.groceryList.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!list) return res.status(404).json({ error: "Not found" });
  const schema = z.object({ name: z.string(), quantity: z.string().optional(), storeCategory: z.string().default("other") });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid item" });
  const item = await prisma.groceryItem.create({ data: { groceryListId: list.id, ...parse.data } });
  res.status(201).json({ item });
});

groceryListsRouter.patch("/items/:itemId", requireAuth, async (req: AuthedRequest, res) => {
  const item = await prisma.groceryItem.findUnique({ where: { id: req.params.itemId }, include: { groceryList: true } });
  if (!item || item.groceryList.userId !== req.userId) return res.status(404).json({ error: "Not found" });
  const schema = z.object({ checked: z.boolean().optional(), name: z.string().optional(), quantity: z.string().optional(), storeCategory: z.string().optional() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid update" });
  const updated = await prisma.groceryItem.update({ where: { id: item.id }, data: parse.data });
  res.json({ item: updated });
});

groceryListsRouter.delete("/items/:itemId", requireAuth, async (req: AuthedRequest, res) => {
  const item = await prisma.groceryItem.findUnique({ where: { id: req.params.itemId }, include: { groceryList: true } });
  if (!item || item.groceryList.userId !== req.userId) return res.status(404).json({ error: "Not found" });
  await prisma.groceryItem.delete({ where: { id: item.id } });
  res.json({ ok: true });
});

groceryListsRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const list = await prisma.groceryList.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!list) return res.status(404).json({ error: "Not found" });
  await prisma.groceryList.delete({ where: { id: list.id } });
  res.json({ ok: true });
});

/**
 * Merge several grocery lists into one consolidated list, deduplicating by
 * name and summing quantities where the unit matches (Section 9).
 */
groceryListsRouter.post("/merge", requireAuth, requireFullAccount, requirePlus, async (req: AuthedRequest, res) => {
  const schema = z.object({ listIds: z.array(z.string()).min(2), title: z.string().default("Combined Grocery List") });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Provide at least 2 listIds" });

  const lists = await prisma.groceryList.findMany({ where: { id: { in: parse.data.listIds }, userId: req.userId }, include: { items: true } });
  const merged = new Map<string, { name: string; quantity: string | null; storeCategory: string }>();

  for (const list of lists) {
    for (const item of list.items) {
      const key = item.name.trim().toLowerCase();
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { name: item.name, quantity: item.quantity, storeCategory: item.storeCategory });
        continue;
      }
      const existingMatch = existing.quantity?.match(/^(\d+(\.\d+)?)\s*(.*)$/);
      const newMatch = item.quantity?.match(/^(\d+(\.\d+)?)\s*(.*)$/);
      if (existingMatch && newMatch && existingMatch[3].trim() === newMatch[3].trim()) {
        const sum = parseFloat(existingMatch[1]) + parseFloat(newMatch[1]);
        existing.quantity = `${sum}${newMatch[3] ? " " + newMatch[3] : ""}`.trim();
      }
      // Units don't match (or one is missing) - keep the first quantity and let the user reconcile manually.
    }
  }

  const combined = await prisma.groceryList.create({
    data: {
      userId: req.userId!,
      title: parse.data.title,
      items: { create: Array.from(merged.values()).map((i) => ({ name: i.name, quantity: i.quantity ?? undefined, storeCategory: i.storeCategory })) },
    },
    include: { items: true },
  });
  res.status(201).json({ groceryList: combined });
});
