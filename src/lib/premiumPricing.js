// Config for FabricNow's consumer "Premium" plan (Garment Tool + Pose Tool +
// SVG customization) — separate product from the API tiers, see
// lib/apiTiers.js for those.
//
// Pricing history:
//   Launched at   $19.99/mo
//   Raised to     $29.99/mo on 2026-09 (now bundles three tools, not one)
//
// Existing subscribers are charged the amount from their Paystack plan. The
// webhook caches the actual amount on the User doc; this list price is used
// only for new subscriptions and the legacy-pricing badge.
//
// CURRENT_PRICE_CENTS below is ONLY used to decide whether to show a
// "legacy pricing" badge (i.e. is this user's cached price below the
// current list price) — it does not drive checkout or billing.
const CURRENT_PRICE_CENTS = 2999; // $29.99 USD fallback for legacy configuration
const CURRENT_PRICE_USD = CURRENT_PRICE_CENTS / 100;

function currentPriceMinor(currency) {
  const raw = process.env.PAYSTACK_PREMIUM_AMOUNT;
  if (raw != null && raw !== "") {
    const amount = Number(raw);
    if (Number.isFinite(amount) && amount > 0) return Math.round(amount * 100);
  }
  return currency === "USD" ? CURRENT_PRICE_CENTS : null;
}

function isGrandfathered(premiumUnitAmountMinor, currency = "USD") {
  const current = currentPriceMinor(currency);
  return typeof premiumUnitAmountMinor === "number" && current != null && premiumUnitAmountMinor < current;
}

function centsToUsd(cents) {
  return typeof cents === "number" ? Math.round(cents) / 100 : null;
}

module.exports = { CURRENT_PRICE_CENTS, CURRENT_PRICE_USD, currentPriceMinor, isGrandfathered, centsToUsd };
