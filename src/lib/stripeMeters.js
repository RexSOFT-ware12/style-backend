// Reports one unit of overage usage to Stripe for the API tiers.
//
// IMPORTANT: Stripe's usage-based billing changed in API version
// 2025-03-31.basil — the old `POST /v1/subscription_items/{id}/usage_records`
// endpoint is gone. Every metered Price now needs a backing Billing Meter,
// and usage is reported with `stripe.billing.meterEvents.create()` instead,
// keyed by the meter's `event_name` + the Stripe customer id (NOT the
// subscription item id — Stripe derives the subscription/price linkage from
// the customer + meter at aggregation time). See scripts/setup-api-billing.js
// for where the Meters themselves get created.
const { OVERAGE } = require("./apiTiers");

/**
 * @param {import("stripe")|null} stripe - already-instantiated Stripe client, or null if unconfigured
 * @param {"segmented"|"bgOnly"} type
 * @param {string} stripeCustomerId
 * @param {string} idempotencyKey - stable per-call key so retries never double-bill.
 *   Callers should derive this from something monotonic (e.g. the ApiKey id
 *   plus the post-increment usage count) rather than a random id, since a
 *   random id would defeat the whole point of deduping retries.
 */
async function reportOverageUnit(stripe, type, stripeCustomerId, idempotencyKey) {
  if (!stripe) {
    console.error("reportOverageUnit called but Stripe isn't configured — overage unit NOT billed:", {
      type,
      stripeCustomerId,
      idempotencyKey,
    });
    return;
  }
  if (!stripeCustomerId) {
    console.error("reportOverageUnit called with no stripeCustomerId — overage unit NOT billed:", { type, idempotencyKey });
    return;
  }

  const meterConfig = OVERAGE[type];
  if (!meterConfig) {
    throw new Error(`Unknown overage type "${type}" — expected "segmented" or "bgOnly".`);
  }

  try {
    await stripe.billing.meterEvents.create({
      event_name: meterConfig.meterEventName,
      payload: {
        stripe_customer_id: stripeCustomerId,
        value: "1", // Stripe requires this as a string
      },
      identifier: idempotencyKey,
    });
  } catch (err) {
    // A failed meter event means this specific overage unit silently goes
    // unbilled — that's a real (if rare) money-losing bug, not just a log
    // line, so this is deliberately loud. It does NOT throw: we already
    // decided not to block the user's API response over billing plumbing
    // (see routes/apiGarmentTool.js in garment-service) — this should be
    // reconciled out-of-band (e.g. a periodic job comparing our usage
    // counters against Stripe's Meter Event Summaries) rather than by
    // failing requests.
    console.error("Failed to report overage unit to Stripe — needs manual reconciliation:", {
      type,
      stripeCustomerId,
      idempotencyKey,
      error: err.message,
    });
  }
}

module.exports = { reportOverageUnit };
