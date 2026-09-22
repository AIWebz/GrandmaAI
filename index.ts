import express from "express";
import cors from "cors";
import path from "path";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { tasksRouter, remindersRouter } from "./routes/tasks";
import { recipesRouter } from "./routes/recipes";
import { familyCookbookRouter } from "./routes/familyCookbook";
import { groceryListsRouter } from "./routes/groceryLists";
import { scheduleRouter } from "./routes/schedule";
import { memoryRouter } from "./routes/memory";
import { chatRouter } from "./routes/chat";
import { notificationsRouter } from "./routes/notifications";
import { subscriptionsRouter } from "./routes/subscriptions";
import { homeRouter } from "./routes/home";
import { configRouter } from "./routes/config";
import { billingRouter, billingWebhookHandler } from "./routes/billing";

const app = express();

app.use(cors());
// Stripe webhook needs the exact raw body for signature verification, so
// it's registered before the global JSON parser below.
app.post("/billing/webhook", express.raw({ type: "application/json" }), billingWebhookHandler);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/health", (_req, res) => res.json({ ok: true }));

const aiLimiter = rateLimit({ windowMs: 60_000, max: 20 });

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/tasks", tasksRouter);
app.use("/reminders", remindersRouter);
app.use("/recipes", recipesRouter);
app.use("/family-cookbook", familyCookbookRouter);
app.use("/grocery-lists", groceryListsRouter);
app.use("/schedule", scheduleRouter);
app.use("/memory", memoryRouter);
app.use("/chat", aiLimiter, chatRouter);
app.use("/notifications", notificationsRouter);
app.use("/subscriptions", subscriptionsRouter);
app.use("/home", homeRouter);
app.use("/config", configRouter);
app.use("/billing", billingRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong on our end - please try again." });
});

app.listen(env.port, () => {
  console.log(`Grandma AI server listening on :${env.port}`);
});
