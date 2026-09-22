import { Router, Request, Response } from "express";
import Stripe = require("stripe");
import { stripe, isStripeConfigured } from "../services/billing/stripeClient";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { requireAuth, requireFullAccount, AuthedRequest } from "../middleware/auth";

export const billingRouter = Router();

/** Client-safe billing config - publishable key + price, no secrets. */
billingRouter.get("/config", (_req, res) => {
  res.json({
    configured: isStripeConfigured(),
    publishableKey: env.stripePublishableKey,
    priceMonthlyUsd: env.grandmaPlusPriceUsd,
  });
});

/**
 * Creates a Stripe Checkout Session for the Grandma+ monthly subscription
 * and returns its hosted URL - the client opens this in a browser (see
 * mobile/src/hooks/useStripeCheckout.ts). This is the "durable ownership /
 * purchase" action, so it's gated the same way a native IAP purchase would
 * be: full account required.
 */
billingRouter.post("/checkout-session", requireAuth, requireFullAccount, async (req: AuthedRequest, res) => {
  if (!isStripeConfigured() || !stripe) {
    return res.status(501).json({ error: "NOT_CONFIGURED", message: "Stripe isn't configured on the server yet." });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  let subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });

  let customerId = subscription?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    subscription = await prisma.subscription.upsert({
      where: { userId: user.id },
      update: { stripeCustomerId: customerId },
      create: { userId: user.id, stripeCustomerId: customerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: env.stripePriceIdMonthly, quantity: 1 }],
    success_url: `${env.appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.appUrl}/billing/cancel`,
    allow_promotion_codes: true,
  });

  res.json({ url: session.url });
});

/** Stripe's hosted portal for managing/canceling the subscription. */
billingRouter.post("/portal-session", requireAuth, requireFullAccount, async (req: AuthedRequest, res) => {
  if (!isStripeConfigured() || !stripe) {
    return res.status(501).json({ error: "NOT_CONFIGURED", message: "Stripe isn't configured on the server yet." });
  }
  const subscription = await prisma.subscription.findUnique({ where: { userId: req.userId } });
  if (!subscription?.stripeCustomerId) {
    return res.status(404).json({ error: "NO_STRIPE_CUSTOMER", message: "No subscription to manage yet." });
  }
  const portal = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${env.appUrl}/billing/return`,
  });
  res.json({ url: portal.url });
});

/** Plain landing pages the Checkout/Portal redirect flows land on inside the in-app browser. */
billingRouter.get("/success", (_req, res) => {
  res.send("<html><body style='font-family:sans-serif;text-align:center;padding:48px;'><h2>You're all set with Grandma+ &hearts;</h2><p>You can close this window and go back to the app.</p></body></html>");
});
billingRouter.get("/cancel", (_req, res) => {
  res.send("<html><body style='font-family:sans-serif;text-align:center;padding:48px;'><h2>No charge made.</h2><p>You can close this window and go back to the app.</p></body></html>");
});
billingRouter.get("/return", (_req, res) => {
  res.send("<html><body style='font-family:sans-serif;text-align:center;padding:48px;'><h2>All set.</h2><p>You can close this window and go back to the app.</p></body></html>");
});

function tierFromStripeStatus(status: Stripe.Subscription.Status): "PLUS" | "FREE" {
  return status === "active" || status === "trialing" ? "PLUS" : "FREE";
}

async function upsertFromStripeSubscription(stripeSub: Stripe.Subscription, userIdHint?: string) {
  const customerId = typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer.id;
  const existing = await prisma.subscription.findFirst({
    where: { OR: [{ stripeSubscriptionId: stripeSub.id }, { stripeCustomerId: customerId }] },
  });
  const userId = existing?.userId ?? userIdHint;
  if (!userId) return; // Nothing we can map this event back to.

  const periodEnd = (stripeSub as any).current_period_end as number | undefined;
  await prisma.subscription.upsert({
    where: { userId },
    update: {
      tier: tierFromStripeStatus(stripeSub.status),
      platform: "stripe",
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSub.id,
      expiresAt: periodEnd ? new Date(periodEnd * 1000) : null,
      autoRenew: !stripeSub.cancel_at_period_end,
    },
    create: {
      userId,
      tier: tierFromStripeStatus(stripeSub.status),
      platform: "stripe",
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSub.id,
      expiresAt: periodEnd ? new Date(periodEnd * 1000) : null,
      autoRenew: !stripeSub.cancel_at_period_end,
    },
  });
}

/**
 * Stripe webhook handler - mounted in index.ts with express.raw() BEFORE
 * the global express.json() middleware, since signature verification needs
 * the exact raw request body. Handles the events that actually change
 * entitlement; anything else is acknowledged and ignored.
 */
export async function billingWebhookHandler(req: Request, res: Response) {
  if (!stripe || !env.stripeWebhookSecret) {
    return res.status(501).json({ error: "NOT_CONFIGURED" });
  }

  let event: Stripe.Event;
  try {
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, signature as string, env.stripeWebhookSecret);
  } catch (err: any) {
    return res.status(400).json({ error: "INVALID_SIGNATURE", message: err.message });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription && session.client_reference_id) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await upsertFromStripeSubscription(sub, session.client_reference_id);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        await upsertFromStripeSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const stripeSub = event.data.object as Stripe.Subscription;
        const customerId = typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer.id;
        await prisma.subscription.updateMany({
          where: { OR: [{ stripeSubscriptionId: stripeSub.id }, { stripeCustomerId: customerId }] },
          data: { tier: "FREE", autoRenew: false },
        });
        break;
      }
      default:
        break; // Acknowledged, no entitlement change needed.
    }
  } catch (err) {
    console.error("Stripe webhook handling error:", err);
    // Still 200 - Stripe retries on non-2xx, and a DB hiccup here shouldn't
    // cause a storm of retries for an event we may have partially applied.
  }

  res.json({ received: true });
}
