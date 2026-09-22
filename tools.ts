import { AiTool } from "./types";

/**
 * The tool/function-calling schema Grandma's model can invoke. This is the
 * mechanism by which chat turns into real app actions (Section 4) - there
 * is no keyword or regex matching on chat text anywhere in this codebase.
 * Provider-agnostic (Anthropic and Ollama both consume this same shape -
 * see services/ai/provider.ts).
 */
export const GRANDMA_TOOLS: AiTool[] = [
  {
    name: "create_task",
    description: "Create a to-do item for the user, optionally recurring or scheduled for a specific date.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        category: { type: "string", enum: ["CLEANING", "LAUNDRY", "KITCHEN", "YARD", "SHOPPING", "PETS", "HOUSEHOLD", "OTHER"] },
        dueDate: { type: "string", description: "ISO date, e.g. 2025-01-01. Omit for today." },
        recurrence: { type: "string", enum: ["NONE", "DAILY", "WEEKLY"] },
      },
      required: ["title"],
    },
  },
  {
    name: "generate_chore_batch",
    description: "Generate a short, achievable batch of 3-5 chore tasks around a theme (e.g. 'kitchen is a mess'). Never generate more than 5 at once.",
    input_schema: {
      type: "object",
      properties: {
        theme: { type: "string", description: "What area/problem this batch addresses, e.g. 'kitchen cleanup'" },
        tasks: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 5,
          description: "3 to 5 short, concrete task titles",
        },
        category: { type: "string", enum: ["CLEANING", "LAUNDRY", "KITCHEN", "YARD", "SHOPPING", "PETS", "HOUSEHOLD", "OTHER"] },
      },
      required: ["theme", "tasks"],
    },
  },
  {
    name: "update_task",
    description: "Update, complete, snooze, or delete an existing task by id.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        completed: { type: "boolean" },
        newDueDate: { type: "string" },
        delete: { type: "boolean" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "create_reminder",
    description: "Create a time-based reminder for the user.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        remindAt: { type: "string", description: "ISO datetime" },
      },
      required: ["title", "remindAt"],
    },
  },
  {
    name: "create_recipe",
    description: "Generate a full recipe (from a dish name, or from ingredients the user has on hand) and save it so it can be rendered as a recipe card.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        category: { type: "string" },
        servings: { type: "number" },
        prepMinutes: { type: "number" },
        cookMinutes: { type: "number" },
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        ingredients: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, quantity: { type: "string" }, unit: { type: "string" } },
            required: ["name"],
          },
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: { text: { type: "string" }, tip: { type: "string" } },
            required: ["text"],
          },
        },
        substitutions: { type: "array", items: { type: "string" } },
      },
      required: ["name", "ingredients", "steps"],
    },
  },
  {
    name: "create_grocery_list",
    description: "Create a new grocery list, optionally pre-filled with items (e.g. from a recipe the user is making tonight).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: { type: "string" },
              storeCategory: { type: "string", enum: ["produce", "dairy", "meat", "bakery", "pantry", "frozen", "other"] },
            },
            required: ["name"],
          },
        },
      },
      required: ["title"],
    },
  },
  {
    name: "add_grocery_item",
    description: "Add one or more items to an existing grocery list.",
    input_schema: {
      type: "object",
      properties: {
        groceryListId: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: { type: "string" },
              storeCategory: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
      required: ["groceryListId", "items"],
    },
  },
  {
    name: "update_schedule",
    description: "Add, move, or remove an event on the user's daily planner. Never move an event the user marked as fixed/locked.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "move", "remove"] },
        eventId: { type: "string", description: "Required for move/remove" },
        title: { type: "string" },
        startTime: { type: "string", description: "ISO datetime" },
        endTime: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "plan_day",
    description: "Lay out a realistic plan for the rest of today or tomorrow from the user's existing tasks and fixed events, without moving anything fixed.",
    input_schema: {
      type: "object",
      properties: {
        forDate: { type: "string", description: "ISO date" },
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, startTime: { type: "string" }, endTime: { type: "string" } },
            required: ["title", "startTime"],
          },
        },
      },
      required: ["forDate", "blocks"],
    },
  },
  {
    name: "save_memory_fact",
    description: "Remember a durable fact the user shared (favorite/disliked food, dietary restriction, favorite recipe, routine, skill level, schedule pattern). Only call this if the user has memory turned on and the fact is useful for cooking/planning/chores - never infer health or financial details.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["favorite_food", "disliked_food", "dietary_restriction", "favorite_recipe", "routine", "skill_level", "schedule", "other"] },
        fact: { type: "string" },
      },
      required: ["category", "fact"],
    },
  },
];
