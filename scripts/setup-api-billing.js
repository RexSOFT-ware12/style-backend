// One-time setup for the API-tier Stripe objects (Starter $80/mo, Growth
// $2,900/mo, plus shared metered overage prices). Meters are safe to re-run
// (an existing active meter with the same event_name is reused instead of
// erroring), but Products/Prices are NOT idempotent — every run creates new
// ones, so re-running this after a successful run will leave old
// Starter/Growth Products/Prices behind (archive them by hand in the
// Dashboard if that happens).
//
//   STRIPE_SECRET_KEY=sk_test_... node src/scripts/setup-api-billing.js
//
// It prints the env vars to paste into .env afterward. Nothing here reads
// or writes the app's database — this only talks to Stripe.
//
// Uses Stripe's Billing Meters API (stripe.billing.meters /
// stripe.billing.meterEvents) — the current mechanism for usage-based
// billing as of API version 2025-03-31.basil. Older tutorials describing
// `usage_type: "metered"` WITHOUT a backing Meter, or the
// `subscription_items/{id}/usage_records` endpoint, are for the removed
// legacy system and won't work against a current Stripe account.
//
// No "enterprise" setup here on purpose — that tier has no self-serve
// Checkout (see routes/billing.js's api-checkout route, which rejects
// "enterprise"). For a negotiated enterprise deal: create a Customer +
// custom Price(s) by hand in the Stripe Dashboard (or a one-off script
// modeled on this one), then create the ApiSubscription document directly
// in MongoDB with tier: "enterprise" and whatever quota/pricing was agreed.
require("dotenv").config();

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Set STRIPE_SECRET_KEY before running this script.");
  process.exit(1);
}

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { OVERAGE } = require("../lib/apiTiers");

async function getOrCreateMeter({ eventName, displayName }) {
  // Meters are uniquely keyed by event_name (one active meter per name), so
  // re-running this script — or a previous run that failed partway through
  // after creating meters but before creating prices — leaves a meter
  // Stripe will refuse to recreate. Look for an existing active one first
  // and reuse it; only create a new one if none exists yet.
  const existing = await stripe.billing.meters.list({ status: "active", limit: 100 });
  const found = existing.data.find((m) => m.event_name === eventName);
  if (found) {
    console.log(`  Reusing existing active meter for "${eventName}": ${found.id}`);
    return found;
  }
  console.log(`  Creating new meter for "${eventName}"...`);
  return stripe.billing.meters.create({
    display_name: displayName,
    event_name: eventName,
    default_aggregation: { formula: "sum" },
    customer_mapping: { event_payload_key: "stripe_customer_id", type: "by_id" },
    value_settings: { event_payload_key: "value" },
  });
}

async function main() {
  console.log("Setting up Billing Meters (reusing any that already exist)...");
  const segmentedMeter = await getOrCreateMeter({
    eventName: OVERAGE.segmented.meterEventName,
    displayName: "Garment images processed (with part segmentation)",
  });
  const bgOnlyMeter = await getOrCreateMeter({
    eventName: OVERAGE.bgOnly.meterEventName,
    displayName: "Garment images processed (background removal only)",
  });

  console.log("Creating shared overage Prices (same rate on every tier)...");
  const overageSegmentedPrice = await stripe.prices.create({
    currency: "usd",
    unit_amount_decimal: String(Math.round(OVERAGE.segmented.unitUsd * 100)), // 4900 = $49.00
    billing_scheme: "per_unit",
    recurring: { usage_type: "metered", interval: "month", meter: segmentedMeter.id },
    product_data: { name: "Garment API overage — with segmentation" },
  });
  const overageBgOnlyPrice = await stripe.prices.create({
    currency: "usd",
    unit_amount_decimal: String(Math.round(OVERAGE.bgOnly.unitUsd * 100)), // 2000 = $20.00
    billing_scheme: "per_unit",
    recurring: { usage_type: "metered", interval: "month", meter: bgOnlyMeter.id },
    product_data: { name: "Garment API overage — background removal only" },
  });

  console.log("Creating Starter/Growth base Products + Prices...");
  const starterProduct = await stripe.products.create({ name: "FabricNow API — Starter" });
  const starterPrice = await stripe.prices.create({
    currency: "usd",
    unit_amount: 8000, // $80.00
    recurring: { interval: "month" }, // usage_type defaults to "licensed"
    product: starterProduct.id,
  });

  const growthProduct = await stripe.products.create({ name: "FabricNow API — Growth" });
  const growthPrice = await stripe.prices.create({
    currency: "usd",
    unit_amount: 290000, // $2,900.00
    recurring: { interval: "month" },
    product: growthProduct.id,
  });

  console.log("\nDone. Add these to style-backend/.env:\n");
  console.log(`STRIPE_API_STARTER_PRICE_ID=${starterPrice.id}`);
  console.log(`STRIPE_API_GROWTH_PRICE_ID=${growthPrice.id}`);
  console.log(`STRIPE_API_OVERAGE_SEGMENTED_PRICE_ID=${overageSegmentedPrice.id}`);
  console.log(`STRIPE_API_OVERAGE_BGONLY_PRICE_ID=${overageBgOnlyPrice.id}`);
  console.log(
    "\n(Meter ids aren't needed as env vars — runtime code reports usage by event_name, not meter id. " +
      `For reference: segmented meter = ${segmentedMeter.id}, bg-only meter = ${bgOnlyMeter.id}.)`
  );
  console.log(
    "\nReminder: your existing Stripe webhook endpoint (the one already configured for " +
      "POST /api/billing/webhook) needs the customer.subscription.created/updated/deleted and " +
      "checkout.session.completed events enabled, which it should already have from the consumer " +
      "Premium plan setup — no new webhook endpoint needed for the API tiers."
  );
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});