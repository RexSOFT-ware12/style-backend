// Shared logic for deciding whether a user currently has access to the
// gated tools (Garment Tool, Pose Tool, SVG customization on the Design
// Patterns page): free for 3 days from signup, then premium-only.
//
// Kept as one small pure function so the /billing/status endpoint (what the
// account UI shows) and the requirePremium middleware (what actually blocks
// requests) can never drift out of sync with each other.

const { CURRENT_PRICE_USD, isGrandfathered, centsToUsd } = require("./premiumPricing");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @param {import("../models/User")} user - a loaded Mongoose User document
 * @returns {{
 *   hasAccess: boolean,
 *   plan: "free"|"premium",
 *   subscriptionStatus: string,
 *   trialActive: boolean,
 *   trialEndsAt: Date,
 *   trialDaysLeft: number,
 *   currentPremiumPriceUsd: number,
 *   premiumPriceUsd: number|null,
 *   isGrandfathered: boolean,
 * }}
 */
function getEntitlement(user) {
  const now = Date.now();
  const trialEndsAt = user.trialEndsAt || new Date(now);
  const trialActive = now < trialEndsAt.getTime();
  const trialDaysLeft = trialActive
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / MS_PER_DAY))
    : 0;

  // "Premium" only counts if Stripe also currently agrees the subscription
  // is in good standing — a canceled/past_due subscription downgrades
  // access even if `plan` hasn't been flipped back to "free" yet.
  const subscriptionGood = user.plan === "premium" && ["active", "trialing"].includes(user.subscriptionStatus);

  // What this specific user is actually billed, cached from Stripe on the
  // User doc (see models/User.js) — null until the webhook has stamped it
  // at least once (e.g. a user who has never subscribed, or a pre-existing
  // subscriber before backfill-premium-price.js has run for them).
  const premiumPriceUsd = centsToUsd(user.premiumUnitAmountCents);

  return {
    hasAccess: trialActive || subscriptionGood,
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    trialActive,
    trialEndsAt,
    trialDaysLeft,
    // Today's list price for NEW subscribers (what /pricing shows someone
    // who isn't already subscribed).
    currentPremiumPriceUsd: CURRENT_PRICE_USD,
    // What THIS user is actually billed, if known. Null rather than
    // falling back to currentPremiumPriceUsd, so the frontend can tell
    // "we don't know yet" apart from "you pay full price."
    premiumPriceUsd,
    isGrandfathered: isGrandfathered(user.premiumUnitAmountCents),
  };
}

module.exports = { getEntitlement };
