import { getAiProvider } from "../ai/provider";

const DIGITIZE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    ingredients: { type: "array", items: { type: "string" } },
    steps: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    uncertainPassages: { type: "array", items: { type: "string" } },
  },
  required: ["ingredients", "steps", "confidence"],
};

export interface DigitizedRecipe {
  name?: string;
  ingredients: string[];
  steps: string[];
  confidence: number;
  uncertainPassages: string[];
}

const LOW_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Family Cookbook handwriting digitization (Section 6). Uses vision +
 * structured output to extract ingredients/steps while preserving
 * original wording; low-confidence results are flagged with
 * `needsReview: true` rather than silently guessing, and the caller always
 * keeps the original photo attached alongside the digitized version.
 * Works against whichever AiProvider is configured - with Ollama this
 * needs a vision-capable local model (default `llava`).
 */
export async function digitizeHandwrittenRecipe(imageBase64: string, mediaType: string): Promise<DigitizedRecipe & { needsReview: boolean }> {
  const system =
    "You transcribe photos of handwritten recipe cards into structured text. Preserve the original wording, spelling quirks, and phrasing as closely as possible - don't 'improve' or modernize the language. If any part is illegible or you're guessing, note it in uncertainPassages and lower your confidence score accordingly. Return ONLY the JSON object described - no prose, no markdown fences.";
  const parsed = await getAiProvider().generateStructuredFromImage<DigitizedRecipe>(
    system,
    "Transcribe this handwritten recipe card.",
    imageBase64,
    mediaType,
    DIGITIZE_SCHEMA
  );
  return { ...parsed, needsReview: parsed.confidence < LOW_CONFIDENCE_THRESHOLD };
}
