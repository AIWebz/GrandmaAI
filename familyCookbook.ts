import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { requireAuth, requireFullAccount, requirePlus, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { digitizeHandwrittenRecipe } from "../services/ocr/recipeVision";
import { isAiConfigured } from "../services/ai/provider";

export const familyCookbookRouter = Router();

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 15 * 1024 * 1024 } });

function serialize(r: any) {
  return { ...r, ingredients: JSON.parse(r.ingredients ?? "[]"), steps: JSON.parse(r.steps ?? "[]") };
}

// Family Cookbook is private by default (Section 6) - every route here is scoped to req.userId only.
familyCookbookRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const recipes = await prisma.familyCookbookRecipe.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } });
  res.json({ recipes: recipes.map(serialize) });
});

familyCookbookRouter.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const recipe = await prisma.familyCookbookRecipe.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!recipe) return res.status(404).json({ error: "Not found" });
  res.json({ recipe: serialize(recipe) });
});

const MANUAL_SCHEMA = z.object({
  name: z.string().min(1),
  relatedPerson: z.string().optional(),
  memoryStory: z.string().optional(),
  ingredients: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
});

familyCookbookRouter.post("/", requireAuth, requireFullAccount, requirePlus, async (req: AuthedRequest, res) => {
  const parse = MANUAL_SCHEMA.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid recipe" });
  const recipe = await prisma.familyCookbookRecipe.create({
    data: {
      userId: req.userId!,
      name: parse.data.name,
      relatedPerson: parse.data.relatedPerson,
      memoryStory: parse.data.memoryStory,
      ingredients: JSON.stringify(parse.data.ingredients),
      steps: JSON.stringify(parse.data.steps),
    },
  });
  res.status(201).json({ recipe: serialize(recipe) });
});

/** Upload a photo of a handwritten recipe card; runs vision OCR and returns a draft for review. */
familyCookbookRouter.post("/digitize", requireAuth, requireFullAccount, requirePlus, upload.single("photo"), async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "photo file required" });
  if (!isAiConfigured()) {
    return res.status(503).json({ error: "AI_UNAVAILABLE", message: "I'm having trouble reading photos right now - try again in a moment?" });
  }

  try {
    const imageBuffer = fs.readFileSync(req.file.path);
    const digitized = await digitizeHandwrittenRecipe(imageBuffer.toString("base64"), req.file.mimetype);

    const recipe = await prisma.familyCookbookRecipe.create({
      data: {
        userId: req.userId!,
        name: digitized.name ?? "Untitled family recipe",
        ingredients: JSON.stringify(digitized.ingredients),
        steps: JSON.stringify(digitized.steps),
        transcriptionConfidence: digitized.confidence,
        needsReview: digitized.needsReview,
        originalPhotoUrl: `/uploads/${path.basename(req.file.path)}`,
        photoUrl: `/uploads/${path.basename(req.file.path)}`,
      },
    });
    res.status(201).json({ recipe: serialize(recipe), uncertainPassages: digitized.uncertainPassages });
  } catch {
    res.status(503).json({ error: "AI_UNAVAILABLE", message: "I couldn't quite make that out - try a clearer photo, or type it in by hand?" });
  }
});

/** Add/replace a finished-dish photo. */
familyCookbookRouter.post("/:id/photo", requireAuth, requireFullAccount, requirePlus, upload.single("photo"), async (req: AuthedRequest, res) => {
  const recipe = await prisma.familyCookbookRecipe.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!recipe) return res.status(404).json({ error: "Not found" });
  if (!req.file) return res.status(400).json({ error: "photo file required" });
  const updated = await prisma.familyCookbookRecipe.update({
    where: { id: recipe.id },
    data: { photoUrl: `/uploads/${path.basename(req.file.path)}` },
  });
  res.json({ recipe: serialize(updated) });
});

familyCookbookRouter.patch("/:id", requireAuth, requireFullAccount, requirePlus, async (req: AuthedRequest, res) => {
  const recipe = await prisma.familyCookbookRecipe.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!recipe) return res.status(404).json({ error: "Not found" });

  const schema = z.object({
    name: z.string().optional(),
    relatedPerson: z.string().optional(),
    memoryStory: z.string().optional(),
    ingredients: z.array(z.string()).optional(),
    steps: z.array(z.string()).optional(),
    needsReview: z.boolean().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid update" });

  const updated = await prisma.familyCookbookRecipe.update({
    where: { id: recipe.id },
    data: {
      ...parse.data,
      ingredients: parse.data.ingredients ? JSON.stringify(parse.data.ingredients) : undefined,
      steps: parse.data.steps ? JSON.stringify(parse.data.steps) : undefined,
    },
  });
  res.json({ recipe: serialize(updated) });
});

familyCookbookRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const recipe = await prisma.familyCookbookRecipe.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!recipe) return res.status(404).json({ error: "Not found" });
  await prisma.familyCookbookRecipe.delete({ where: { id: recipe.id } });
  res.json({ ok: true });
});
