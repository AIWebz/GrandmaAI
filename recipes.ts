import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireFullAccount, requirePlus, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { generateRecipe } from "../services/ai/recipeService";
import { isAiConfigured } from "../services/ai/provider";
import { getRecipeUsageStatus, incrementRecipeUsage } from "../utils/usageCap";

export const recipesRouter = Router();

function serialize(r: any) {
  return {
    ...r,
    ingredients: JSON.parse(r.ingredients),
    steps: JSON.parse(r.steps),
    substitutions: JSON.parse(r.substitutions ?? "[]"),
    dietaryTags: JSON.parse(r.dietaryTags ?? "[]"),
    savedByUsers: JSON.parse(r.savedByUsers ?? "[]"),
  };
}

recipesRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const { category, search, difficulty, maxPrepMinutes, dietary } = req.query as Record<string, string>;
  const where: any = {};
  if (category) where.category = category;
  if (difficulty) where.difficulty = difficulty;
  if (maxPrepMinutes) where.prepMinutes = { lte: Number(maxPrepMinutes) };
  if (search) where.name = { contains: search };

  let recipes = await prisma.recipe.findMany({ where, orderBy: { createdAt: "desc" }, take: 60 });
  if (dietary) {
    const tags = dietary.split(",");
    recipes = recipes.filter((r) => tags.every((t) => JSON.parse(r.dietaryTags ?? "[]").includes(t)));
  }
  res.json({ recipes: recipes.map(serialize) });
});

recipesRouter.get("/saved", requireAuth, async (req: AuthedRequest, res) => {
  const recipes = await prisma.recipe.findMany({
    where: { savedByUsers: { contains: `"${req.userId}"` } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ recipes: recipes.map(serialize) });
});

recipesRouter.get("/usage", requireAuth, async (req: AuthedRequest, res) => {
  res.json(await getRecipeUsageStatus(req.userId!));
});

recipesRouter.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: req.params.id } });
  if (!recipe) return res.status(404).json({ error: "Not found" });
  res.json({ recipe: serialize(recipe) });
});

/**
 * Ask Grandma to generate a recipe - used by empty-category states and
 * direct requests. Free tier gets a small daily allowance of these on top
 * of the "traditional" catalog; Grandma+ is unlimited.
 */
recipesRouter.post("/generate", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ prompt: z.string().min(1), category: z.string().optional(), dietary: z.array(z.string()).optional() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid request" });

  if (!isAiConfigured()) {
    return res.status(503).json({ error: "AI_UNAVAILABLE", message: "I'm having a little trouble hearing you right now - try again in a moment?" });
  }
  const usage = await getRecipeUsageStatus(req.userId!);
  if (usage.atCap) {
    return res.status(402).json({ error: "RECIPE_CAP_REACHED", usage, message: "You've used today's free recipes - Grandma+ gives you unlimited." });
  }

  try {
    const generated = await generateRecipe(parse.data.prompt, parse.data.dietary);
    const recipe = await prisma.recipe.create({
      data: {
        userId: req.userId,
        name: generated.name,
        category: parse.data.category ?? generated.category ?? "family recipe",
        servings: generated.servings ?? 4,
        prepMinutes: generated.prepMinutes ?? 10,
        cookMinutes: generated.cookMinutes ?? 20,
        difficulty: generated.difficulty ?? "easy",
        ingredients: JSON.stringify(generated.ingredients),
        steps: JSON.stringify(generated.steps),
        substitutions: JSON.stringify(generated.substitutions ?? []),
        dietaryTags: JSON.stringify(generated.dietaryTags ?? []),
        isGenerated: true,
      },
    });
    await incrementRecipeUsage(req.userId!);
    res.status(201).json({ recipe: serialize(recipe) });
  } catch {
    res.status(503).json({ error: "AI_UNAVAILABLE", message: "I'm having a little trouble hearing you right now - try again in a moment?" });
  }
});

/** Adjust servings client-side is fine, but scaling ingredient quantities needs numeric parsing - do it server-side for consistency. */
recipesRouter.get("/:id/scale", requireAuth, async (req: AuthedRequest, res) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: req.params.id } });
  if (!recipe) return res.status(404).json({ error: "Not found" });
  const targetServings = Number(req.query.servings ?? recipe.servings);
  const factor = targetServings / recipe.servings;
  const ingredients = (JSON.parse(recipe.ingredients) as any[]).map((i) => {
    const qty = parseFloat(i.quantity);
    return { ...i, quantity: isNaN(qty) ? i.quantity : String(Math.round(qty * factor * 100) / 100) };
  });
  res.json({ servings: targetServings, ingredients });
});

/** Saving to "My Recipes" is a durable-ownership action -> requires a full account. */
recipesRouter.post("/:id/save", requireAuth, requireFullAccount, async (req: AuthedRequest, res) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: req.params.id } });
  if (!recipe) return res.status(404).json({ error: "Not found" });
  const saved: string[] = JSON.parse(recipe.savedByUsers ?? "[]");
  if (!saved.includes(req.userId!)) saved.push(req.userId!);
  const updated = await prisma.recipe.update({ where: { id: recipe.id }, data: { savedByUsers: JSON.stringify(saved) } });
  res.json({ recipe: serialize(updated) });
});

recipesRouter.post("/:id/unsave", requireAuth, async (req: AuthedRequest, res) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: req.params.id } });
  if (!recipe) return res.status(404).json({ error: "Not found" });
  const saved: string[] = JSON.parse(recipe.savedByUsers ?? "[]").filter((id: string) => id !== req.userId);
  const updated = await prisma.recipe.update({ where: { id: recipe.id }, data: { savedByUsers: JSON.stringify(saved) } });
  res.json({ recipe: serialize(updated) });
});

/** Push all ingredients from this recipe into a new grocery list - grocery list generation is a Grandma+ feature. */
recipesRouter.post("/:id/grocery-list", requireAuth, requireFullAccount, requirePlus, async (req: AuthedRequest, res) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: req.params.id } });
  if (!recipe) return res.status(404).json({ error: "Not found" });
  const ingredients = JSON.parse(recipe.ingredients) as { name: string; quantity?: string; unit?: string }[];
  const list = await prisma.groceryList.create({
    data: {
      userId: req.userId!,
      title: `${recipe.name} ingredients`,
      items: { create: ingredients.map((i) => ({ name: i.name, quantity: [i.quantity, i.unit].filter(Boolean).join(" ") })) },
    },
    include: { items: true },
  });
  res.status(201).json({ groceryList: list });
});
