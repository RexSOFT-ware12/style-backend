// Same idea as lib/entitlement.js (the consumer Premium plan), for the API
// tiers. Kept as one pure function so /billing/api-key-status (what
// garment-service's requireApiAccess middleware calls before every request)
// and /billing/api-status (what the account dashboard shows) can never
// drift out of sync.
//
// Unlike the consumer plan, there's no free trial here — API access always
// requires an active paid ApiSubscription. Quota is a SOFT cap: being over
// it doesn't flip hasAccess to false, it just means the next processed
// image gets reported to Stripe as billable overage (see lib/stripeMeters.js
// and garment-service's routes/apiGarmentTool.js).
//
// Credits: unused images roll over and never expire (lib/apiCredits.js).
// `quota` = fresh monthly images, `rolloverCredits` = carried-over balance,
// `allowance` = quota + rolloverCredits, `remaining` = allowance - used.
//
// Plans an admin marked as paid by hand (source "manual") have no Stripe
// subscription to end them, so they lapse a few days after currentPeriodEnd
// unless the admin records the next payment.
//
// @param {import("../models/ApiSubscription")|null} apiSub
const { usedOf, quotaOf, rolloverOf, allowanceOf, remainingOf, isManualLapsed } = require("./apiCredits");

function getApiEntitlement(apiSub) {
  if (!apiSub) {
    return {
      hasAccess: false,
      tier: null,
      status: "none",
      source: null,
      quota: null,
      rolloverCredits: 0,
      allowance: null,
      used: 0,
      remaining: null,
      currentPeriodEnd: null,
      lapsed: false,
    };
  }

  const lapsed = isManualLapsed(apiSub);
  const hasAccess = ["active", "trialing"].includes(apiSub.status) && !lapsed;

  return {
    hasAccess,
    tier: apiSub.tier,
    status: lapsed ? "expired" : apiSub.status,
    source: apiSub.source || "stripe",
    quota: quotaOf(apiSub),
    rolloverCredits: rolloverOf(apiSub),
    allowance: allowanceOf(apiSub),
    used: usedOf(apiSub),
    remaining: remainingOf(apiSub),
    currentPeriodEnd: apiSub.currentPeriodEnd,
    lapsed,
  };
}

module.exports = { getApiEntitlement };
