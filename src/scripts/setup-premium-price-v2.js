// One-time script: creates the new $29.99/mo Price for the consumer
// Premium plan, on the SAME Stripe Product as the existing $19.99 Price
// (so it shows up as one product with price history in the Stripe
// Dashboard, and so existing subscriptions/invoices/reporting that
// reference the product aren't disturbed).
//
//   STRIPE_SECRET_KEY=sk_test_... STRIPE_PREMIUM_PRICE_ID=price_... \
//     node src/scripts/setup-premium-price-v2.js
//
// Run this ONCE per Stripe account/mode (test, then live before launch).
// It does NOT touch any existing customer or subscription — Stripe Prices
// are immutable and existing subscriptions keep referencing whatever Price
// they were created with regardless of what this script does. All this
// script does is create one new Price object and tell you what to do next.
//
// After running it:
//   1. Update STRIPE_PREMIUM_PRICE_ID in .env to the NEW price id it
//      prints. From that point on, POST /api/billing/checkout (new
//      subscribers only) uses the new $29.99 price.
//   2. Existing subscribers are unaffected — their Stripe subscription
//      still references the old $19.99 Price until they explicitly change
//      plans. Nothing else to do for them to stay grandfathered.
//   3. Existing subscribers who subscribed BEFORE this repo started
//      caching User.premiumPriceId/premiumUnitAmountCents (i.e. before
//      this change shipped) won't have those fields populated until their
//      subscription next fires a customer.subscription.updated webhook
//      (e.g. at renewal) — run scripts/backfill-premium-price.js once to
//      populate them immediately instead of waiting on that.
require("dotenv").config();

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Set STRIPE_SECRET_KEY before running this script.");
  process.exit(1);
}
if (!process.env.STRIPE_PREMIUM_PRICE_ID) {
  console.error(
    "Set STRIPE_PREMIUM_PRICE_ID to the EXISTING $19.99 price id first — this script reads it to find " +
      "which Product to attach the new $29.99 price to. (This is the price id currently in your .env," +
      " i.e. the one that's about to become the 'legacy' price.)"
  );
  process.exit(1);
}

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { CURRENT_PRICE_CENTS, CURRENT_PRICE_USD } = require("../lib/premiumPricing");

async function main() {
  const oldPriceId = process.env.STRIPE_PREMIUM_PRICE_ID;

  console.log(`Looking up existing price ${oldPriceId} to find its Product...`);
  const oldPrice = await stripe.prices.retrieve(oldPriceId);
  const productId = typeof oldPrice.product === "string" ? oldPrice.product : oldPrice.product.id;

  if (oldPrice.unit_amount === CURRENT_PRICE_CENTS) {
    console.log(
      `Heads up: ${oldPriceId} is already $${CURRENT_PRICE_USD} — this script is meant to run BEFORE ` +
        "you update STRIPE_PREMIUM_PRICE_ID, using the OLD $19.99 price id. Proceeding anyway in case " +
        "this is intentional (e.g. re-running after a price change further down the line)."
    );
  }

  console.log(`Creating new $${CURRENT_PRICE_USD}/mo Price on product ${productId}...`);
  const newPrice = await stripe.prices.create({
    currency: "usd",
    unit_amount: CURRENT_PRICE_CENTS,
    recurring: { interval: "month" },
    product: productId,
  });

  console.log("\nDone. Update style-backend/.env:\n");
  console.log(`STRIPE_PREMIUM_PRICE_ID=${newPrice.id}`);
  console.log(
    `\n(Old price, now the "legacy"/grandfathered one that existing subscribers stay on: ${oldPriceId}. ` +
      "Nothing reads that id from env going forward — it lives on already-created subscriptions in Stripe, " +
      "not in app config — but it's worth noting somewhere for support/reference.)"
  );
  console.log(
    "\nNext: if you have subscribers who predate User.premiumPriceId being tracked, run " +
      "scripts/backfill-premium-price.js once to populate it for them immediately, instead of waiting " +
      "for their next renewal webhook."
  );
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
