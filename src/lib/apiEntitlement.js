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
// @param {import("../models/ApiSubscription")|null} apiSub
function getApiEntitlement(apiSub) {
  if (!apiSub) {
    return {
      hasAccess: false,
      tier: null,
      status: "none",
      quota: null,
      used: 0,
      remaining: null,
      currentPeriodEnd: null,
    };
  }

  const hasAccess = ["active", "trialing"].includes(apiSub.status);
  const used = (apiSub.usage?.segmentedCount || 0) + (apiSub.usage?.bgOnlyCount || 0);
  const quota = typeof apiSub.quota === "number" ? apiSub.quota : null;

  return {
    hasAccess,
    tier: apiSub.tier,
    status: apiSub.status,
    quota,
    used,
    remaining: quota == null ? null : Math.max(0, quota - used),
    currentPeriodEnd: apiSub.currentPeriodEnd,
  };
}

module.exports = { getApiEntitlement };
