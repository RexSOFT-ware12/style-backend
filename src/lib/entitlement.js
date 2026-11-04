// Shared logic for deciding whether a user currently has access to the
// gated tools (Garment Tool, Pose Tool, SVG customization on the Design
// Patterns page): free for 3 days from signup, then premium-only.
//
// Kept as one small pure function so the /billing/status endpoint (what the
// account UI shows) and the requirePremium middleware (what actually blocks
// requests) can never drift out of sync with each other.

const { CURRENT_PRICE_USD, currentPriceMinor, isGrandfathered, centsToUsd } = require("./premiumPricing");

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
 *   currentPremiumPriceUsd: number|null,
 *   premiumPriceUsd: number|null,
 *   premiumPriceAmount: number|null,
 *   premiumPriceCurrency: string,
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

  // Only Paystack-backed subscriptions grant paid access. Scheduled
  // cancellations retain access through the already-paid period.
  const paidThroughCancellation =
    user.subscriptionCancelAtPeriodEnd &&
    user.subscriptionStatus === "canceled" &&
    user.subscriptionCurrentPeriodEnd &&
    new Date(user.subscriptionCurrentPeriodEnd).getTime() > now;
  const subscriptionGood =
    user.subscriptionProvider === "paystack" &&
    user.plan === "premium" &&
    (["active", "trialing"].includes(user.subscriptionStatus) || paidThroughCancellation);

  // What this specific user is actually billed, cached from Paystack on the
  // User doc — null until a subscription webhook has recorded it.
  // GHS is the settlement currency; never expose a GHS amount in the UI.
  // Keep the USD catalogue amount as the display price. Existing records that
  // predate this field fall back to the current USD catalogue price.
  const premiumPriceUsd = user.premiumPriceUsd ?? null;
  const configuredCurrentPriceMinor = currentPriceMinor("USD");

  return {
    hasAccess: trialActive || subscriptionGood,
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    cancelAtPeriodEnd: Boolean(user.subscriptionCancelAtPeriodEnd),
    trialActive,
    trialEndsAt,
    trialDaysLeft,
    // Today's list price for NEW subscribers (what /pricing shows someone
    // who isn't already subscribed).
    currentPremiumPriceUsd: configuredCurrentPriceMinor / 100,
    // What THIS user is actually billed, if known. Null rather than
    // falling back to currentPremiumPriceUsd, so the frontend can tell
    // "we don't know yet" apart from "you pay full price."
    premiumPriceUsd,
    isGrandfathered: isGrandfathered(typeof premiumPriceUsd === "number" ? Math.round(premiumPriceUsd * 100) : null, "USD"),
  };
}

module.exports = { getEntitlement };
