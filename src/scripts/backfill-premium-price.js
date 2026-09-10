// One-time backfill: populates User.premiumPriceId / premiumUnitAmountCents
// for subscribers who subscribed before this repo started caching those
// fields on the User doc (see routes/billing.js's webhook and
// lib/premiumPricing.js). Safe to run more than once — it just re-reads
// the current state from Stripe each time.
//
// Without this, an existing subscriber's account page would show
// premiumPriceUsd: null (and isGrandfathered: false) until their
// subscription happens to fire a customer.subscription.updated webhook on
// its own (e.g. at their next renewal) — this script just does that lookup
// proactively instead of waiting.
//
//   STRIPE_SECRET_KEY=sk_... MONGODB_URI=... node src/scripts/backfill-premium-price.js
require("dotenv").config();

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Set STRIPE_SECRET_KEY before running this script.");
  process.exit(1);
}

const { connectDB, mongoose } = require("../db");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const User = require("../models/User");

async function main() {
  await connectDB();

  const candidates = await User.find({
    stripeSubscriptionId: { $exists: true, $ne: null },
    premiumPriceId: { $exists: false },
  });

  console.log(`Found ${candidates.length} subscriber(s) missing a cached premium price.`);

  let updated = 0;
  let skipped = 0;

  for (const user of candidates) {
    try {
      const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      const item = subscription.items?.data?.[0];
      if (!item?.price) {
        console.warn(`  skip ${user.email}: subscription ${user.stripeSubscriptionId} has no price item`);
        skipped++;
        continue;
      }

      user.premiumPriceId = item.price.id;
      user.premiumUnitAmountCents = item.price.unit_amount ?? null;
      await user.save();
      console.log(`  ${user.email}: cached ${item.price.id} ($${(item.price.unit_amount ?? 0) / 100}/mo)`);
      updated++;
    } catch (err) {
      console.error(`  FAILED ${user.email} (sub ${user.stripeSubscriptionId}):`, err.message);
      skipped++;
    }
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
