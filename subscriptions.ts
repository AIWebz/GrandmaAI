import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireFullAccount, AuthedRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { validateAppleReceipt, validateGooglePurchase } from "../services/subscriptions/validators";
import { env } from "../config/env";
import { isStripeConfigured } from "../services/billing/stripeClient";

export const subscriptionsRouter = Router();

subscriptionsRouter.get("/status", requireAuth, async (req: AuthedRequest, res) => {
  const sub = await prisma.subscription.findUnique({ where: { userId: req.userId } });
  const active = sub?.tier === "PLUS" && (!sub.expiresAt || sub.expiresAt > new Date());
  res.json({
    tier: active ? "PLUS" : "FREE",
    platform: sub?.platform ?? null,
    expiresAt: sub?.expiresAt ?? null,
    autoRenew: sub?.autoRenew ?? false,
    products: {
      monthly: env.grandmaPlusMonthlyProductId,
      annual: env.grandmaPlusAnnualProductId,
      priceMonthlyUsd: env.grandmaPlusPriceUsd,
    },
    stripeConfigured: isStripeConfigured(),
  });
});

/** Purchasing is a durable-ownership action -> requires a full account. Server-side receipt validation only; client never trusts its own IAP callback. */
subscriptionsRouter.post("/validate/apple", requireAuth, requireFullAccount, async (req: AuthedRequest, res) => {
  const schema = z.object({ receiptData: z.string().min(1) });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "receiptData required" });

  const result = await validateAppleReceipt(parse.data.receiptData);
  if (result.notConfigured) {
    return res.status(501).json({ error: "NOT_CONFIGURED", message: "Apple receipt validation needs APPLE_SHARED_SECRET configured on the server." });
  }
  if (!result.valid) return res.status(402).json({ error: "INVALID_RECEIPT" });

  const sub = await prisma.subscription.upsert({
    where: { userId: req.userId! },
    update: { tier: "PLUS", platform: "ios", expiresAt: result.expiresAt, autoRenew: result.autoRenew ?? false, originalTransactionId: result.originalTransactionId },
    create: { userId: req.userId!, tier: "PLUS", platform: "ios", expiresAt: result.expiresAt, autoRenew: result.autoRenew ?? false, originalTransactionId: result.originalTransactionId },
  });
  res.json({ subscription: sub });
});

subscriptionsRouter.post("/validate/google", requireAuth, requireFullAccount, async (req: AuthedRequest, res) => {
  const schema = z.object({ packageName: z.string(), productId: z.string(), purchaseToken: z.string() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid request" });

  try {
    const result = await validateGooglePurchase(parse.data.packageName, parse.data.productId, parse.data.purchaseToken);
    if (result.notConfigured) {
      return res.status(501).json({ error: "NOT_CONFIGURED", message: "Google Play validation needs GOOGLE_SERVICE_ACCOUNT_JSON configured on the server." });
    }
    if (!result.valid) return res.status(402).json({ error: "INVALID_PURCHASE" });
    const sub = await prisma.subscription.upsert({
      where: { userId: req.userId! },
      update: { tier: "PLUS", platform: "android", expiresAt: result.expiresAt, autoRenew: result.autoRenew ?? false },
      create: { userId: req.userId!, tier: "PLUS", platform: "android", expiresAt: result.expiresAt, autoRenew: result.autoRenew ?? false },
    });
    res.json({ subscription: sub });
  } catch (e: any) {
    res.status(501).json({ error: "NOT_CONFIGURED", message: e.message });
  }
});

/** Restore purchases (Section 15 requirement) - re-runs validation against the platform's current entitlement. */
subscriptionsRouter.post("/restore", requireAuth, requireFullAccount, async (req: AuthedRequest, res) => {
  const sub = await prisma.subscription.findUnique({ where: { userId: req.userId } });
  res.json({ subscription: sub ?? { tier: "FREE" } });
});
