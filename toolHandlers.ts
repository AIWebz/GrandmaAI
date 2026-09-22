import { prisma } from "../../db/prisma";
import { TaskCategory, RecurrenceRule } from "../../types/enums";
import { isPlusUser } from "../../utils/subscriptionTier";
import { getRecipeUsageStatus, incrementRecipeUsage } from "../../utils/usageCap";

const PLUS_REQUIRED_RESULT = { error: "PLUS_REQUIRED", message: "That's a Grandma+ feature." };

export interface ToolInvocationResult {
  tool: string;
  input: any;
  result: any;
  card?: { type: "task" | "grocery_list" | "recipe" | "reminder" | "schedule"; data: any };
}

async function handleCreateTask(userId: string, input: any): Promise<ToolInvocationResult> {
  const task = await prisma.task.create({
    data: {
      userId,
      title: input.title,
      category: (input.category as TaskCategory) ?? "OTHER",
      dueDate: input.dueDate ? new Date(input.dueDate) : new Date(),
      recurrence: (input.recurrence as RecurrenceRule) ?? "NONE",
      source: "grandma",
    },
  });
  return { tool: "create_task", input, result: { taskId: task.id }, card: { type: "task", data: task } };
}

async function handleGenerateChoreBatch(userId: string, input: any): Promise<ToolInvocationResult> {
  const tasks = (input.tasks as string[]).slice(0, 5);
  const created = await Promise.all(
    tasks.map((title) =>
      prisma.task.create({
        data: { userId, title, category: (input.category as TaskCategory) ?? "CLEANING", dueDate: new Date(), source: "grandma" },
      })
    )
  );
  return { tool: "generate_chore_batch", input, result: { count: created.length }, card: { type: "task", data: { theme: input.theme, tasks: created } } };
}

async function handleUpdateTask(userId: string, input: any): Promise<ToolInvocationResult> {
  const task = await prisma.task.findFirst({ where: { id: input.taskId, userId } });
  if (!task) return { tool: "update_task", input, result: { error: "Task not found" } };
  if (input.delete) {
    await prisma.task.delete({ where: { id: task.id } });
    return { tool: "update_task", input, result: { deleted: true } };
  }
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      completed: input.completed ?? task.completed,
      completedAt: input.completed ? new Date() : null,
      dueDate: input.newDueDate ? new Date(input.newDueDate) : task.dueDate,
    },
  });
  return { tool: "update_task", input, result: { taskId: updated.id }, card: { type: "task", data: updated } };
}

async function handleCreateReminder(userId: string, input: any): Promise<ToolInvocationResult> {
  const reminder = await prisma.reminder.create({
    data: { userId, title: input.title, remindAt: new Date(input.remindAt) },
  });
  return { tool: "create_reminder", input, result: { reminderId: reminder.id }, card: { type: "reminder", data: reminder } };
}

async function handleCreateRecipe(userId: string, input: any): Promise<ToolInvocationResult> {
  const usage = await getRecipeUsageStatus(userId);
  if (usage.atCap) {
    return { tool: "create_recipe", input, result: { error: "RECIPE_CAP_REACHED", message: "You've used today's free recipes - Grandma+ gives you unlimited recipes." } };
  }
  const recipe = await prisma.recipe.create({
    data: {
      userId,
      name: input.name,
      category: input.category ?? "family recipe",
      servings: input.servings ?? 4,
      prepMinutes: input.prepMinutes ?? 10,
      cookMinutes: input.cookMinutes ?? 20,
      difficulty: input.difficulty ?? "easy",
      ingredients: JSON.stringify(input.ingredients ?? []),
      steps: JSON.stringify(input.steps ?? []),
      substitutions: JSON.stringify(input.substitutions ?? []),
      isGenerated: true,
    },
  });
  await incrementRecipeUsage(userId);
  return { tool: "create_recipe", input, result: { recipeId: recipe.id }, card: { type: "recipe", data: recipe } };
}

async function handleCreateGroceryList(userId: string, input: any): Promise<ToolInvocationResult> {
  if (!(await isPlusUser(userId))) {
    return { tool: "create_grocery_list", input, result: PLUS_REQUIRED_RESULT };
  }
  const list = await prisma.groceryList.create({
    data: {
      userId,
      title: input.title,
      items: { create: (input.items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, storeCategory: i.storeCategory ?? "other" })) },
    },
    include: { items: true },
  });
  return { tool: "create_grocery_list", input, result: { groceryListId: list.id }, card: { type: "grocery_list", data: list } };
}

async function handleAddGroceryItem(userId: string, input: any): Promise<ToolInvocationResult> {
  if (!(await isPlusUser(userId))) {
    return { tool: "add_grocery_item", input, result: PLUS_REQUIRED_RESULT };
  }
  const list = await prisma.groceryList.findFirst({ where: { id: input.groceryListId, userId } });
  if (!list) return { tool: "add_grocery_item", input, result: { error: "Grocery list not found" } };
  await prisma.groceryItem.createMany({
    data: (input.items ?? []).map((i: any) => ({ groceryListId: list.id, name: i.name, quantity: i.quantity, storeCategory: i.storeCategory ?? "other" })),
  });
  const updated = await prisma.groceryList.findUnique({ where: { id: list.id }, include: { items: true } });
  return { tool: "add_grocery_item", input, result: { added: input.items?.length ?? 0 }, card: { type: "grocery_list", data: updated } };
}

async function handleUpdateSchedule(userId: string, input: any): Promise<ToolInvocationResult> {
  if (input.action === "add") {
    const event = await prisma.scheduleEvent.create({
      data: { userId, title: input.title, startTime: new Date(input.startTime), endTime: input.endTime ? new Date(input.endTime) : null },
    });
    return { tool: "update_schedule", input, result: { eventId: event.id }, card: { type: "schedule", data: event } };
  }
  if (input.action === "move") {
    const event = await prisma.scheduleEvent.findFirst({ where: { id: input.eventId, userId } });
    if (!event) return { tool: "update_schedule", input, result: { error: "Event not found" } };
    if (event.isFixed) return { tool: "update_schedule", input, result: { error: "This is fixed and can't be moved automatically." } };
    const updated = await prisma.scheduleEvent.update({ where: { id: event.id }, data: { startTime: new Date(input.startTime), endTime: input.endTime ? new Date(input.endTime) : event.endTime } });
    return { tool: "update_schedule", input, result: { eventId: updated.id }, card: { type: "schedule", data: updated } };
  }
  if (input.action === "remove") {
    const event = await prisma.scheduleEvent.findFirst({ where: { id: input.eventId, userId } });
    if (event && !event.isFixed) await prisma.scheduleEvent.delete({ where: { id: event.id } });
    return { tool: "update_schedule", input, result: { removed: true } };
  }
  return { tool: "update_schedule", input, result: { error: "Unknown action" } };
}

async function handlePlanDay(userId: string, input: any): Promise<ToolInvocationResult> {
  if (!(await isPlusUser(userId))) {
    return { tool: "plan_day", input, result: { ...PLUS_REQUIRED_RESULT, message: "Laying out a whole day at once is a Grandma+ feature - I'm happy to add things one at a time though!" } };
  }
  const forDate = new Date(input.forDate);
  const events = await Promise.all(
    (input.blocks as any[]).map((b) =>
      prisma.scheduleEvent.create({
        data: { userId, title: b.title, startTime: new Date(b.startTime), endTime: b.endTime ? new Date(b.endTime) : null },
      })
    )
  );
  return { tool: "plan_day", input, result: { count: events.length }, card: { type: "schedule", data: { forDate, events } } };
}

async function handleSaveMemoryFact(userId: string, input: any): Promise<ToolInvocationResult> {
  if (!(await isPlusUser(userId))) {
    return { tool: "save_memory_fact", input, result: { skipped: true, reason: "Long-term memory is a Grandma+ feature." } };
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.memoryOptIn) {
    return { tool: "save_memory_fact", input, result: { skipped: true, reason: "Memory is not turned on for this user." } };
  }
  const fact = await prisma.memoryFact.create({ data: { userId, category: input.category, fact: input.fact } });
  return { tool: "save_memory_fact", input, result: { factId: fact.id } };
}

export const TOOL_HANDLERS: Record<string, (userId: string, input: any) => Promise<ToolInvocationResult>> = {
  create_task: handleCreateTask,
  generate_chore_batch: handleGenerateChoreBatch,
  update_task: handleUpdateTask,
  create_reminder: handleCreateReminder,
  create_recipe: handleCreateRecipe,
  create_grocery_list: handleCreateGroceryList,
  add_grocery_item: handleAddGroceryItem,
  update_schedule: handleUpdateSchedule,
  plan_day: handlePlanDay,
  save_memory_fact: handleSaveMemoryFact,
};
