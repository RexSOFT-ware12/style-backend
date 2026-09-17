// One-off helper: finds any active Stripe Billing Meters matching the
// event names our garment API overage billing uses, and deactivates them.
// Run this if setup-api-billing.js fails with "An active meter already
// exists for event name '...'" — it clears the way for that script (or a
// fresh manual meter) to be created again.
//
//   STRIPE_SECRET_KEY=sk_live_... node src/scripts/deactivate-stuck-meters.js
//
// Safe to run multiple times — if a meter's already inactive/gone, it's
// just skipped and logged as "not found."
require("dotenv").config();

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Set STRIPE_SECRET_KEY before running this script.");
  process.exit(1);
}

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { OVERAGE } = require("../lib/apiTiers");

const TARGET_EVENT_NAMES = [OVERAGE.segmented.meterEventName, OVERAGE.bgOnly.meterEventName];

async function main() {
  console.log("Looking up active meters...");
  const { data: activeMeters } = await stripe.billing.meters.list({ status: "active", limit: 100 });

  for (const eventName of TARGET_EVENT_NAMES) {
    const match = activeMeters.find((m) => m.event_name === eventName);
    if (!match) {
      console.log(`  "${eventName}": no active meter found, nothing to do.`);
      continue;
    }
    console.log(`  "${eventName}": found active meter ${match.id} ("${match.display_name}"). Deactivating...`);
    await stripe.billing.meters.deactivate(match.id);
    console.log(`  "${eventName}": deactivated.`);
  }

  console.log("\nDone. You can now re-run setup-api-billing.js.");
}

main().catch((err) => {
  console.error("Failed:", err.message || err);
  process.exit(1);
});