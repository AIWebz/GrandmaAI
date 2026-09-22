/**
 * One-time convenience script: creates the "Grandma+" Stripe Product and a
 * $14.99/month recurring Price via the API, so you don't have to click
 * through the Dashboard. Run with STRIPE_SECRET_KEY set:
 *
 *   npm run stripe:setup
 *
 * Prints the price id to put in STRIPE_PRICE_ID_MONTHLY. Safe to re-run -
 * it reuses an existing "Grandma+" product/price if one already exists.
 */
import "dotenv/config";
import Stripe from "stripe";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("Set STRIPE_SECRET_KEY in server/.env first, then re-run this script.");
    process.exit(1);
  }
  const stripe = new Stripe(key);
  const priceUsd = Number(process.env.GRANDMA_PLUS_PRICE_USD ?? 14.99);

  const products = await stripe.products.search({ query: "name:'Grandma+' AND active:'true'" });
  let product = products.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: "Grandma+",
      description: "No ads, unlimited recipes, grocery list generation, long-term memory, shared Family Cookbook, and advanced planning.",
    });
    console.log(`Created product ${product.id}`);
  } else {
    console.log(`Reusing existing product ${product.id}`);
  }

  const existingPrices = await stripe.prices.list({ product: product.id, active: true });
  let price = existingPrices.data.find((p) => p.unit_amount === Math.round(priceUsd * 100) && p.recurring?.interval === "month");
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(priceUsd * 100),
      currency: "usd",
      recurring: { interval: "month" },
      nickname: "Grandma+ Monthly",
    });
    console.log(`Created price ${price.id} ($${priceUsd}/month)`);
  } else {
    console.log(`Reusing existing price ${price.id} ($${priceUsd}/month)`);
  }

  console.log("\nAdd this to server/.env:");
  console.log(`STRIPE_PRICE_ID_MONTHLY="${price.id}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
