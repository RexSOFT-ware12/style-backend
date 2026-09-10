// Config for FabricNow's consumer "Premium" plan (Garment Tool + Pose Tool +
// SVG customization) — separate product from the API tiers, see
// lib/apiTiers.js for those.
//
// Pricing history:
//   Launched at   $19.99/mo
//   Raised to     $29.99/mo on 2026-09 (now bundles three tools, not one)
//
// Existing subscribers are grandfathered at whatever price their Stripe
// subscription was actually created with — we never migrate a live
// subscription to a new Price behind someone's back. Concretely:
//   - `STRIPE_PREMIUM_PRICE_ID` in .env always points at the CURRENT
//     self-serve price (now the $29.99 Price object — see
//     scripts/setup-premium-price-v2.js). New Checkout sessions always use
//     whatever this env var currently points to.
//   - Each user's ACTUAL price is cached on their User doc
//     (premiumPriceId / premiumUnitAmountCents), stamped from the Stripe
//     subscription itself whenever the webhook sees it — never from this
//     env var. That's what makes a pre-existing subscriber's $19.99 sticky:
//     their Stripe subscription keeps referencing the old Price object
//     until *they* change plans, regardless of what new subscribers pay.
//
// CURRENT_PRICE_CENTS below is ONLY used to decide whether to show a
// "legacy pricing" badge (i.e. is this user's cached price below the
// current list price) — it does not drive checkout or billing.
const CURRENT_PRICE_CENTS = 2999; // $29.99 — bump this if the price changes again
const CURRENT_PRICE_USD = CURRENT_PRICE_CENTS / 100;

function isGrandfathered(premiumUnitAmountCents) {
  return typeof premiumUnitAmountCents === "number" && premiumUnitAmountCents < CURRENT_PRICE_CENTS;
}

function centsToUsd(cents) {
  return typeof cents === "number" ? Math.round(cents) / 100 : null;
}

module.exports = { CURRENT_PRICE_CENTS, CURRENT_PRICE_USD, isGrandfathered, centsToUsd };
