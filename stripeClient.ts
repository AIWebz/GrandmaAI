import Stripe from "stripe";
import { env } from "../../config/env";

/**
 * `stripe` is null until STRIPE_SECRET_KEY is set - every call site checks
 * `isStripeConfigured()` first and returns a clear NOT_CONFIGURED error
 * rather than crashing (same pattern as the Apple/Google IAP validators).
 */
export const stripe = env.stripeSecretKey ? new Stripe(env.stripeSecretKey) : null;

export function isStripeConfigured(): boolean {
  return Boolean(stripe && env.stripePriceIdMonthly);
}
