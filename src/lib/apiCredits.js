// All the maths for API image credits lives here, so Stripe renewals,
// admin-recorded manual payments and the usage endpoint can never disagree.
//
// THE RULE: unused credits never expire.
//   allowance this period = quota (fresh monthly credits) + rolloverCredits
//   remaining             = allowance - used this period
// When a new billing period starts, whatever is left over (remaining, never
// below 0) becomes the new `rolloverCredits`, `used` goes back to 0, and the
// fresh monthly `quota` is added on top as the new purchase.
//
// Example (Growth, 250/mo): month 1 uses 100 -> 150 left. Month 2 allowance =
// 250 + 150 = 400. Uses 50 -> 350 left. Month 3 allowance = 250 + 350 = 600.
//
// Going OVER the allowance is still allowed and billed as overage (soft cap,
// unchanged from before) — overage never creates negative credits.

const MANUAL_GRACE_DAYS = 3; // manual subscriptions keep working this long past their end date

const usedOf = (sub) => (sub?.usage?.segmentedCount || 0) + (sub?.usage?.bgOnlyCount || 0);
const quotaOf = (sub) => (typeof sub?.quota === "number" ? sub.quota : null);
const rolloverOf = (sub) => Math.max(0, Number(sub?.rolloverCredits) || 0);

/** Total credits spendable this period, or null when the plan is uncapped. */
function allowanceOf(sub) {
  const q = quotaOf(sub);
  return q == null ? null : q + rolloverOf(sub);
}

/** Credits left this period (never negative), or null when uncapped. */
function remainingOf(sub) {
  const a = allowanceOf(sub);
  return a == null ? null : Math.max(0, a - usedOf(sub));
}

/** Would the NEXT processed image be billed as overage? */
function isOverAllowance(sub, usedBefore) {
  const a = allowanceOf(sub);
  return a != null && usedBefore >= a;
}

/**
 * Mongo `$set` fragment for a period that has just ENDED: carry the unused
 * credits forward and reset the usage counters.
 */
function rollPeriodSet(sub) {
  const carry = remainingOf(sub) ?? 0;
  return {
    rolloverCredits: carry,
    "usage.segmentedCount": 0,
    "usage.bgOnlyCount": 0,
  };
}

function addMonthsUTC(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * An admin recorded a direct payment for one more month of a MANUAL plan.
 *  - period already over (or brand-new plan): behaves like a normal renewal —
 *    leftovers carry forward, usage resets, a new month starts today.
 *  - paid early (period still running): the new month is added to the end of
 *    the current one and the new quota is added to the credits straight away,
 *    so nothing the customer already has is lost or reset.
 *
 * @param {object|null} sub  existing ApiSubscription (or null)
 * @param {number|null} newQuota quota for the tier being paid for (null = uncapped)
 * @param {Date} [now]
 * @param {{forceFresh?: boolean}} [opts]
 * @returns {{ set: object, mode: "new"|"renewed-late"|"renewed-early" }}
 */
function planManualPayment(sub, newQuota, now = new Date(), { forceFresh = false } = {}) {
  const end = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  // `forceFresh` (used when the admin switches the customer to a different
  // tier) always starts a clean period today, carrying leftovers over.
  const stillRunning =
    !forceFresh && !!sub && ["active", "trialing"].includes(sub.status) && end && end.getTime() > now.getTime();

  if (stillRunning) {
    const set = { currentPeriodEnd: addMonthsUTC(end, 1) };
    if (newQuota != null) {
      // Same-tier early renewal: the extra month's quota joins the credits now.
      set.rolloverCredits = rolloverOf(sub) + newQuota;
    }
    return { set, mode: "renewed-early" };
  }

  // Carry leftovers using the quota the customer HAD, then switch to the new one.
  const carry = sub ? remainingOf(sub) ?? 0 : 0;
  return {
    set: {
      rolloverCredits: carry,
      "usage.segmentedCount": 0,
      "usage.bgOnlyCount": 0,
      currentPeriodStart: now,
      currentPeriodEnd: addMonthsUTC(now, 1),
    },
    mode: sub ? "renewed-late" : "new",
  };
}

/** Manual plans have no Stripe to cancel them — they simply lapse. */
function isManualLapsed(sub, now = new Date()) {
  if (!sub || sub.source !== "manual" || !sub.currentPeriodEnd) return false;
  const graceMs = MANUAL_GRACE_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() > new Date(sub.currentPeriodEnd).getTime() + graceMs;
}

module.exports = {
  MANUAL_GRACE_DAYS,
  usedOf,
  quotaOf,
  rolloverOf,
  allowanceOf,
  remainingOf,
  isOverAllowance,
  rollPeriodSet,
  planManualPayment,
  isManualLapsed,
  addMonthsUTC,
};
