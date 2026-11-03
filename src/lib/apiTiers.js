// Config for FabricNow's API-access tiers (separate product from the
// $19.99-29.99/mo consumer "Premium" plan — see routes/billing.js for that
// one). These are for developers calling the Garment Tool programmatically
// via an API key, through garment-service's /api/v1/garment/process route.
//
// Paystack pricing is configured in the merchant currency via the
// PAYSTACK_*_AMOUNT environment variables below.
//   API Starter    — 3 processed images/mo included
//   API Growth     — 250 processed images/mo included
//   API Enterprise custom, ~$9,000/mo reference point — negotiated volume
//     (e.g. ~10,000 images/mo), set by hand per customer
//     (set up the self-serve plans in Paystack; see the environment checklist)
//
// Overage (same per-unit rate regardless of tier, once the included quota
// for the current billing period is used up):
// Per-image overage rates use the same Paystack currency as the subscriptions.
//
// Quota is a *soft* cap: going over it doesn't block the call, it just
// starts getting billed as a Paystack authorization charge. If you'd rather
// hard-block at the quota instead of billing past it, that's a one-line
// change in middleware/requireApiAccess.js (garment-service) — flag it
// there rather than here.

const API_TIERS = {
  starter: {
    id: "starter",
    label: "API Starter",
    monthlyPriceUsd: 80,
    quota: 3,
    planCodeEnvVar: "PAYSTACK_API_STARTER_PLAN_CODE",
    amountEnvVar: "PAYSTACK_API_STARTER_AMOUNT",
  },
  growth: {
    id: "growth",
    label: "API Growth",
    monthlyPriceUsd: 2900,
    quota: 250,
    planCodeEnvVar: "PAYSTACK_API_GROWTH_PLAN_CODE",
    amountEnvVar: "PAYSTACK_API_GROWTH_AMOUNT",
  },
  // No self-serve Checkout for this one — see /api/billing/api-checkout,
  // which explicitly rejects "enterprise". An admin creates the
  // ApiSubscription doc by hand with a negotiated `quota` and billing terms.
  // Kept here mainly so tier labels/validation
  // have one shared list.
  enterprise: {
    id: "enterprise",
    label: "API Enterprise",
    monthlyPriceUsd: null,
    quota: null,
    planCodeEnvVar: null,
    // Not billed automatically — every enterprise deal is negotiated and
    // set by hand (see notes above). Kept purely as a starting reference
    // point for sales conversations at ~10,000 images/mo.
    referenceMonthlyPriceUsd: 9000,
    referenceQuota: 10000,
  },
};

// Paystack authorization charges are shared across starter/growth (same
// per-image rate regardless of tier), so unlike the monthly plan they aren't
// per-tier.
const OVERAGE = {
  segmented: {
    label: "segmented (background removal + part tracing)",
    amountEnvVar: "PAYSTACK_API_OVERAGE_SEGMENTED_AMOUNT",
  },
  bgOnly: {
    label: "background-removal only",
    amountEnvVar: "PAYSTACK_API_OVERAGE_BGONLY_AMOUNT",
  },
};

function isSelfServeTier(tier) {
  return tier === "starter" || tier === "growth";
}

function getTierConfig(tier) {
  return API_TIERS[tier] || null;
}

module.exports = { API_TIERS, OVERAGE, isSelfServeTier, getTierConfig };