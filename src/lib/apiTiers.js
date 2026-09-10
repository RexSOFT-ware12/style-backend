// Config for FabricNow's API-access tiers (separate product from the
// $19.99-29.99/mo consumer "Premium" plan — see routes/billing.js for that
// one). These are for developers calling the Garment Tool programmatically
// via an API key, through garment-service's /api/v1/garment/process route.
//
// Pricing (agreed 2026-09):
//   API Starter    $49/mo   — 500 processed images/mo included
//   API Growth     $149/mo  — 2,500 processed images/mo included
//   API Enterprise custom  — negotiated volume, set by hand per customer
//     (see scripts/setup-api-billing.js and the "enterprise" notes below)
//
// Overage (same per-unit rate regardless of tier, once the included quota
// for the current billing period is used up):
//   $0.05 / image when the call included part segmentation (the OpenAI +
//         HF-backed path — this is the expensive one)
//   $0.02 / image for background-removal only (local model, cheap)
//
// Quota is a *soft* cap: going over it doesn't block the call, it just
// starts getting billed as metered overage via Stripe. If you'd rather
// hard-block at the quota instead of billing past it, that's a one-line
// change in middleware/requireApiAccess.js (garment-service) — flag it
// there rather than here.

const API_TIERS = {
  starter: {
    id: "starter",
    label: "API Starter",
    monthlyPriceUsd: 49,
    quota: 500,
    // Stripe Price id for the flat monthly base fee. Required in prod.
    basePriceEnvVar: "STRIPE_API_STARTER_PRICE_ID",
  },
  growth: {
    id: "growth",
    label: "API Growth",
    monthlyPriceUsd: 149,
    quota: 2500,
    basePriceEnvVar: "STRIPE_API_GROWTH_PRICE_ID",
  },
  // No self-serve Checkout for this one — see /api/billing/api-checkout,
  // which explicitly rejects "enterprise". An admin creates the
  // ApiSubscription doc by hand (or via a small internal script) with a
  // negotiated `quota` and, if the deal includes it, negotiated Stripe
  // price ids for base/overage. Kept here mainly so tier labels/validation
  // have one shared list.
  enterprise: {
    id: "enterprise",
    label: "API Enterprise",
    monthlyPriceUsd: null,
    quota: null,
    basePriceEnvVar: null,
  },
};

// Overage Stripe Price ids are shared across starter/growth (same $/image
// regardless of tier), so unlike the base price they aren't per-tier.
const OVERAGE = {
  segmented: {
    label: "segmented (background removal + part tracing)",
    unitUsd: 0.05,
    priceEnvVar: "STRIPE_API_OVERAGE_SEGMENTED_PRICE_ID",
    meterEventName: "garment_image_segmented",
  },
  bgOnly: {
    label: "background-removal only",
    unitUsd: 0.02,
    priceEnvVar: "STRIPE_API_OVERAGE_BGONLY_PRICE_ID",
    meterEventName: "garment_image_bg_removed",
  },
};

function isSelfServeTier(tier) {
  return tier === "starter" || tier === "growth";
}

function getTierConfig(tier) {
  return API_TIERS[tier] || null;
}

module.exports = { API_TIERS, OVERAGE, isSelfServeTier, getTierConfig };
