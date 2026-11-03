const express = require("express");
const User = require("../models/User");
const ApiKey = require("../models/ApiKey");
const ApiSubscription = require("../models/ApiSubscription");
const { requireAuth } = require("../middleware/auth");
const { getEntitlement } = require("../lib/entitlement");
const { getApiEntitlement } = require("../lib/apiEntitlement");
const { CURRENT_PRICE_CENTS } = require("../lib/premiumPricing");
const { generateApiKey, hashApiKey } = require("../lib/apiKeyCrypto");
const { API_TIERS, isSelfServeTier, getTierConfig } = require("../lib/apiTiers");
const { reportOverageUnit } = require("../lib/paystackOverages");
const { rollPeriodSet, isOverAllowance, addMonthsUTC } = require("../lib/apiCredits");
const { notifySubscriptionActive, notifySubscriptionCanceled, notifyPaymentFailed } = require("../lib/notify");
const { encrypt, decrypt } = require("../lib/secretsStore");
const {
  disableSubscription,
  getCurrency,
  getPlan,
  initializeTransaction,
} = require("../lib/paystack");

const ACTIVE_STATES = ["active", "trialing"];
const router = express.Router();
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const WORKSPACE_URL = (process.env.WORKSPACE_URL || `${FRONTEND_URL}/workspace`).replace(/\/$/, "");
const PREMIUM_PLAN_CODE = process.env.PAYSTACK_PREMIUM_PLAN_CODE;
const PREMIUM_PRICE_MINOR = CURRENT_PRICE_CENTS;

function findApiTierByPlanCode(planCode) {
  if (!planCode) return null;
  for (const tier of Object.values(API_TIERS)) {
    if (tier.planCodeEnvVar && process.env[tier.planCodeEnvVar] === planCode) return tier.id;
  }
  return null;
}

function getPlanCode(data) {
  return (
    data?.plan?.plan_code ||
    (typeof data?.plan === "string" ? data.plan : null) ||
    data?.plan_code ||
    data?.subscription?.plan?.plan_code ||
    null
  );
}

function getSubscriptionCode(data) {
  return data?.subscription_code || data?.subscription?.subscription_code || null;
}

function getCustomerEmail(data) {
  const email = data?.customer?.email || data?.customer_email || data?.email;
  return typeof email === "string" ? email.toLowerCase() : null;
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getAmountMinor(tier) {
  return Math.round(getTierConfig(tier).monthlyPriceUsd * 100);
}

function handlePaystackError(err, res, next) {
  if (!err.code?.startsWith("PAYSTACK_")) return next(err);
  console.error("Paystack billing request failed:", err.message);
  const status = ["PAYSTACK_PLAN_MISMATCH", "PAYSTACK_SECRET_MISSING", "PAYSTACK_CURRENCY_UNSUPPORTED"].includes(err.code)
    ? 503
    : err.code === "PAYSTACK_NETWORK_ERROR" && err.statusCode === 504
      ? 504
      : 502;
  res.status(status).json({ error: err.message, code: err.code });
}

function paymentMethodsUnavailable(_req, res) {
  res.status(410).json({
    error: "Saved-card management is no longer available. Paystack securely collects payment details during checkout.",
    code: "PAYSTACK_CHECKOUT_REQUIRED",
  });
}

async function findApiSubscription(data, tier) {
  const subscriptionCode = getSubscriptionCode(data);
  if (subscriptionCode) {
    const byCode = await ApiSubscription.findOne({ paystackSubscriptionCode: subscriptionCode });
    if (byCode) return byCode;
  }

  const email = getCustomerEmail(data);
  if (!email || !tier) return null;
  const user = await User.findOne({ email }).select("_id");
  return user ? ApiSubscription.findOne({ userId: user._id, tier }) : null;
}

async function applyPaystackSubscription(data, { canceled = false, notRenewing = false } = {}) {
  const planCode = getPlanCode(data);
  const subscriptionCode = getSubscriptionCode(data);
  const existingApi = subscriptionCode
    ? await ApiSubscription.findOne({ paystackSubscriptionCode: subscriptionCode })
    : null;
  const existingPremium = subscriptionCode
    ? await User.findOne({ paystackSubscriptionCode: subscriptionCode })
    : null;
  const tier = findApiTierByPlanCode(planCode) || existingApi?.tier;
  const email = getCustomerEmail(data);

  let user;
  if (existingApi) user = await User.findById(existingApi.userId);
  else if (existingPremium) user = existingPremium;
  else if ((tier || planCode === PREMIUM_PLAN_CODE) && email) user = await User.findOne({ email });
  if (!user) {
    console.error("Paystack subscription webhook refers to an unknown customer.", { email, planCode, subscriptionCode });
    return;
  }

  const customerCode = data.customer?.customer_code || null;
  const emailToken = data.email_token || data.subscription?.email_token || null;
  const authorizationCode = data.authorization?.authorization_code || null;
  const nextPaymentDate = asDate(data.next_payment_date || data.subscription?.next_payment_date);

  if (tier) {
    const existing = existingApi || await ApiSubscription.findOne({ userId: user._id });
    const now = new Date();
    const periodRolledOver =
      existing?.currentPeriodEnd &&
      now.getTime() >= new Date(existing.currentPeriodEnd).getTime();
    const periodEnd = nextPaymentDate || existing?.currentPeriodEnd || null;
    const set = {
      tier,
      source: "paystack",
      status: canceled ? "canceled" : "active",
      paystackCustomerCode: customerCode,
      paystackSubscriptionCode: subscriptionCode || existing?.paystackSubscriptionCode,
      paystackEmailToken: emailToken ? encrypt(emailToken) : existing?.paystackEmailToken,
      cancelAtPeriodEnd: notRenewing || (canceled && Boolean(periodEnd && periodEnd > now)),
      currentPeriodStart: existing?.currentPeriodEnd && periodRolledOver ? existing.currentPeriodEnd : existing?.currentPeriodStart || now,
      currentPeriodEnd: periodEnd || addMonthsUTC(now, 1),
      ...(!existing || existing.quota == null || existing.tier !== tier
        ? { quota: getTierConfig(tier).quota }
        : {}),
      ...(periodRolledOver ? rollPeriodSet(existing) : {}),
    };
    if (authorizationCode) set.paystackAuthorizationCode = encrypt(authorizationCode);
    const updated = await ApiSubscription.findOneAndUpdate(
      { userId: user._id },
      { $set: set },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!canceled && !notRenewing && !ACTIVE_STATES.includes(existing?.status)) {
      notifySubscriptionActive(user, {
        planName: getTierConfig(tier).label,
        amountCents: data.amount ?? getAmountMinor(tier),
        currency: data.currency || "USD",
        interval: "month",
        renewsOn: updated.currentPeriodEnd,
        trialing: false,
      });
    }
    if (canceled && existing && existing.status !== "canceled") {
      notifySubscriptionCanceled(user, { planName: getTierConfig(tier).label, endsOn: updated.currentPeriodEnd || now });
    }
    if (authorizationCode) await updated.save();
    return;
  }

  if (!existingPremium && (!PREMIUM_PLAN_CODE || planCode !== PREMIUM_PLAN_CODE)) {
    console.error("Paystack subscription webhook has an unrecognized plan code.", { planCode });
    return;
  }

  const wasPremium = user.plan === "premium";
  const wasPastDue = user.subscriptionStatus === "past_due";
  const now = new Date();
  user.subscriptionProvider = "paystack";
  user.paystackCustomerCode = customerCode || user.paystackCustomerCode;
  user.paystackSubscriptionCode = subscriptionCode || user.paystackSubscriptionCode;
  if (emailToken) user.paystackEmailToken = encrypt(emailToken);
  if (authorizationCode) user.paystackAuthorizationCode = encrypt(authorizationCode);
  const periodEnd = nextPaymentDate || user.subscriptionCurrentPeriodEnd || null;
  user.subscriptionCancelAtPeriodEnd = notRenewing || (canceled && Boolean(periodEnd && periodEnd > now));
  user.subscriptionCurrentPeriodEnd = periodEnd || addMonthsUTC(now, 1);
  user.subscriptionStatus = canceled ? "canceled" : "active";
  user.plan = canceled && !user.subscriptionCancelAtPeriodEnd ? "free" : "premium";
  user.premiumPlanCode = planCode || user.premiumPlanCode;
  user.premiumUnitAmountCents = data.amount ?? user.premiumUnitAmountCents ?? PREMIUM_PRICE_MINOR;
  await user.save();

  if (!canceled && !notRenewing && !wasPremium) {
    notifySubscriptionActive(user, {
      planName: "FabricNow Premium",
      amountCents: user.premiumUnitAmountCents,
      currency: data.currency || "USD",
      interval: "month",
      renewsOn: user.subscriptionCurrentPeriodEnd,
      trialing: false,
    });
  } else if (canceled && wasPremium) {
    notifySubscriptionCanceled(user, { planName: "FabricNow Premium", endsOn: user.subscriptionCurrentPeriodEnd || now });
  }
  if (wasPastDue && !canceled) {
    console.info("Paystack reports a successful renewal for a previously past-due Premium subscriber.", { userId: user.id });
  }
}

async function markSubscriptionPastDue(data) {
  const subscriptionCode = getSubscriptionCode(data);
  const tier = findApiTierByPlanCode(getPlanCode(data));
  const apiSub = await findApiSubscription(data, tier);
  if (apiSub) {
    const changed = apiSub.status !== "past_due";
    apiSub.status = "past_due";
    await apiSub.save();
    if (changed) {
      const owner = await User.findById(apiSub.userId);
      if (owner) notifyPaymentFailed(owner, { planName: getTierConfig(apiSub.tier)?.label || "API subscription" });
    }
    return;
  }

  const userQuery = [
    ...(subscriptionCode ? [{ paystackSubscriptionCode: subscriptionCode }] : []),
    ...(PREMIUM_PLAN_CODE && getPlanCode(data) === PREMIUM_PLAN_CODE && getCustomerEmail(data)
      ? [{ email: getCustomerEmail(data) }]
      : []),
  ];
  const user = userQuery.length ? await User.findOne({ $or: userQuery }) : null;
  if (user && user.subscriptionProvider === "paystack") {
    const changed = user.subscriptionStatus !== "past_due";
    user.subscriptionStatus = "past_due";
    user.plan = "free";
    await user.save();
    if (changed) notifyPaymentFailed(user, { planName: "FabricNow Premium" });
  }
}

async function applySuccessfulCharge(data) {
  if (data.status !== "success") return;
  const planCode = getPlanCode(data);
  const tier = findApiTierByPlanCode(planCode);
  const apiSub = await findApiSubscription(data, tier);
  const authorizationCode = data.authorization?.authorization_code;
  const customerCode = data.customer?.customer_code;
  const now = asDate(data.paid_at || data.created_at) || new Date();
  const nextPaymentDate = asDate(data.subscription?.next_payment_date);

  if (apiSub) {
    const periodRolledOver =
      apiSub.currentPeriodEnd &&
      now.getTime() >= new Date(apiSub.currentPeriodEnd).getTime();
    apiSub.status = "active";
    apiSub.source = "paystack";
    apiSub.cancelAtPeriodEnd = false;
    apiSub.paystackCustomerCode = customerCode || apiSub.paystackCustomerCode;
    apiSub.paystackSubscriptionCode = getSubscriptionCode(data) || apiSub.paystackSubscriptionCode;
    if (authorizationCode) apiSub.paystackAuthorizationCode = encrypt(authorizationCode);
    if (periodRolledOver) {
      apiSub.currentPeriodStart = apiSub.currentPeriodEnd;
      apiSub.currentPeriodEnd = nextPaymentDate || addMonthsUTC(now, 1);
      Object.assign(apiSub, rollPeriodSet(apiSub));
    } else {
      apiSub.currentPeriodStart = apiSub.currentPeriodStart || now;
      apiSub.currentPeriodEnd = nextPaymentDate || apiSub.currentPeriodEnd || addMonthsUTC(now, 1);
    }
    await apiSub.save();
    return;
  }

  const email = getCustomerEmail(data);
  const user = email
    ? await User.findOne({ email }).select("+paystackAuthorizationCode")
    : null;
  if (
    tier &&
    user &&
    Number(data.amount) === getAmountMinor(tier) &&
    String(data.currency).toUpperCase() === getCurrency()
  ) {
    const now = asDate(data.paid_at || data.created_at) || new Date();
    const apiSub = await ApiSubscription.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          tier,
          source: "paystack",
          status: "active",
          cancelAtPeriodEnd: false,
          paystackCustomerCode: customerCode,
          paystackSubscriptionCode: getSubscriptionCode(data),
          ...(authorizationCode ? { paystackAuthorizationCode: encrypt(authorizationCode) } : {}),
          currentPeriodStart: now,
          currentPeriodEnd: nextPaymentDate || addMonthsUTC(now, 1),
          quota: getTierConfig(tier).quota,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    notifySubscriptionActive(user, {
      planName: getTierConfig(tier).label,
      amountCents: data.amount,
      currency: data.currency,
      interval: "month",
      renewsOn: apiSub.currentPeriodEnd,
      trialing: false,
    });
    return;
  }
  const matchesPremium =
    planCode === PREMIUM_PLAN_CODE ||
    (getSubscriptionCode(data) && getSubscriptionCode(data) === user?.paystackSubscriptionCode);
  if (!user || !matchesPremium) return;
  const expectedPremiumAmount =
    planCode === PREMIUM_PLAN_CODE ? PREMIUM_PRICE_MINOR : user.premiumUnitAmountCents || PREMIUM_PRICE_MINOR;
  if (Number(data.amount) !== expectedPremiumAmount || String(data.currency).toUpperCase() !== getCurrency()) {
    console.error("Paystack Premium renewal amount or currency did not match the stored plan.", {
      userId: user.id,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
    });
    return;
  }
  const wasPastDue = user.subscriptionStatus === "past_due";
  user.subscriptionStatus = "active";
  user.plan = "premium";
  user.subscriptionProvider = "paystack";
  user.subscriptionCancelAtPeriodEnd = false;
  user.paystackCustomerCode = customerCode || user.paystackCustomerCode;
  user.paystackSubscriptionCode = getSubscriptionCode(data) || user.paystackSubscriptionCode;
  if (authorizationCode) user.paystackAuthorizationCode = encrypt(authorizationCode);
  if (nextPaymentDate) user.subscriptionCurrentPeriodEnd = nextPaymentDate;
  if (planCode === PREMIUM_PLAN_CODE) {
    user.premiumPlanCode = planCode;
    user.premiumUnitAmountCents = Number(data.amount) || PREMIUM_PRICE_MINOR;
  }
  await user.save();
  if (wasPastDue) {
    notifySubscriptionActive(user, {
      planName: "FabricNow Premium",
      amountCents: data.amount || user.premiumUnitAmountCents,
      currency: data.currency || "USD",
      interval: "month",
      renewsOn: user.subscriptionCurrentPeriodEnd,
      trialing: false,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/billing/status
// ---------------------------------------------------------------------------
router.get("/status", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(getEntitlement(user));
  } catch (err) {
    handlePaystackError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/checkout — Paystack monthly Premium plan
// ---------------------------------------------------------------------------
router.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!process.env.PAYSTACK_SECRET_KEY || !PREMIUM_PLAN_CODE) {
      return res.status(503).json({
        error: "Premium subscriptions aren't configured. Set PAYSTACK_SECRET_KEY and PAYSTACK_PREMIUM_PLAN_CODE.",
        code: "PAYSTACK_CONFIGURATION_MISSING",
      });
    }
    if (user.subscriptionProvider === "paystack" && ACTIVE_STATES.includes(user.subscriptionStatus)) {
      return res.status(400).json({ error: "You already have an active Premium subscription.", code: "SUBSCRIPTION_EXISTS" });
    }

    await getPlan(PREMIUM_PLAN_CODE, PREMIUM_PRICE_MINOR);
    const transaction = await initializeTransaction({
      email: user.email,
      amount: PREMIUM_PRICE_MINOR,
      planCode: PREMIUM_PLAN_CODE,
      callbackUrl: `${FRONTEND_URL}/account?upgraded=1&billing=success`,
      metadata: { userId: user.id, product: "premium" },
    });
    res.json({ url: transaction.authorization_url, reference: transaction.reference });
  } catch (err) {
    handlePaystackError(err, res, next);
  }
});

// Paystack exposes cancellation directly and does not provide a hosted
// customer portal or saved-card manager.
router.post("/portal", requireAuth, (_req, res) => {
  res.status(410).json({ error: "Paystack has no billing portal. Use POST /api/billing/cancel to stop renewal." });
});
router.get("/payment-methods", requireAuth, paymentMethodsUnavailable);
router.post("/payment-methods/setup-intent", requireAuth, paymentMethodsUnavailable);
router.post("/payment-methods/confirm", requireAuth, paymentMethodsUnavailable);
router.post("/payment-methods/:id/default", requireAuth, paymentMethodsUnavailable);
router.delete("/payment-methods/:id", requireAuth, paymentMethodsUnavailable);

router.post("/cancel", requireAuth, async (req, res, next) => {
  try {
    const { product } = req.body || {};
    if (product !== "premium" && product !== "api") {
      return res.status(400).json({ error: 'product must be "premium" or "api".' });
    }
    if (product === "premium") {
      const user = await User.findById(req.user.sub).select("+paystackEmailToken");
      if (!user) return res.status(404).json({ error: "User not found." });
      if (user.subscriptionProvider !== "paystack" || !user.paystackSubscriptionCode || !user.paystackEmailToken) {
        return res.status(400).json({ error: "No cancellable Paystack Premium subscription was found." });
      }
      await disableSubscription(user.paystackSubscriptionCode, decrypt(user.paystackEmailToken));
      user.subscriptionCancelAtPeriodEnd = true;
      await user.save();
      return res.json({ canceled: true, accessUntil: user.subscriptionCurrentPeriodEnd || null });
    }

    const apiSub = await ApiSubscription.findOne({ userId: req.user.sub }).select("+paystackEmailToken");
    if (!apiSub || apiSub.source !== "paystack" || !apiSub.paystackSubscriptionCode || !apiSub.paystackEmailToken) {
      return res.status(400).json({ error: "No cancellable Paystack API subscription was found." });
    }
    await disableSubscription(apiSub.paystackSubscriptionCode, decrypt(apiSub.paystackEmailToken));
    apiSub.cancelAtPeriodEnd = true;
    await apiSub.save();
    res.json({ canceled: true, accessUntil: apiSub.currentPeriodEnd || null });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// API access tiers
// ---------------------------------------------------------------------------
router.get("/api-status", requireAuth, async (req, res, next) => {
  try {
    const [apiSub, keys] = await Promise.all([
      ApiSubscription.findOne({ userId: req.user.sub }),
      ApiKey.find({ userId: req.user.sub }).sort({ createdAt: -1 }),
    ]);
    res.json({ entitlement: getApiEntitlement(apiSub), keys: keys.map((key) => key.toJSON()) });
  } catch (err) {
    next(err);
  }
});

router.post("/api-checkout", requireAuth, async (req, res, next) => {
  try {
    const { tier } = req.body || {};
    if (!isSelfServeTier(tier)) {
      return res.status(400).json({
        error: 'tier must be "starter" or "growth". For enterprise/custom volume, contact us directly.',
      });
    }
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({
        error: "API subscriptions aren't configured. Set PAYSTACK_SECRET_KEY.",
        code: "PAYSTACK_SECRET_MISSING",
      });
    }

    const existing = await ApiSubscription.findOne({ userId: user.id });
    if (
      existing &&
      ["paystack", "manual"].includes(existing.source) &&
      ["active", "trialing", "past_due"].includes(existing.status)
    ) {
      return res.status(400).json({
        error: "You already have an active API subscription. Cancel it before subscribing again.",
        code: "API_SUBSCRIPTION_EXISTS",
      });
    }
    const tierConfig = getTierConfig(tier);
    const planCode = process.env[tierConfig.planCodeEnvVar];
    if (!planCode) {
      return res.status(503).json({
        error: `API subscriptions aren't configured. Set ${tierConfig.planCodeEnvVar} to the matching Paystack monthly plan code.`,
        code: "PAYSTACK_PLAN_CODE_MISSING",
      });
    }

    await getPlan(planCode, getAmountMinor(tier));
    const transaction = await initializeTransaction({
      email: user.email,
      amount: getAmountMinor(tier),
      planCode,
      callbackUrl: `${WORKSPACE_URL}?billing=success`,
      metadata: { userId: user.id, product: "api", apiTier: tier },
    });
    res.json({ url: transaction.authorization_url, reference: transaction.reference });
  } catch (err) {
    handlePaystackError(err, res, next);
  }
});

router.post("/api-keys", requireAuth, async (req, res, next) => {
  try {
    const apiSub = await ApiSubscription.findOne({ userId: req.user.sub });
    if (!getApiEntitlement(apiSub).hasAccess) {
      return res.status(402).json({
        error: "An active API subscription is required before generating a key. Subscribe to an API tier first.",
        code: "API_SUBSCRIPTION_REQUIRED",
      });
    }
    const { label } = req.body || {};
    const { fullKey, keyPrefix, keyHash } = generateApiKey();
    const key = await ApiKey.create({
      userId: req.user.sub,
      keyHash,
      keyPrefix,
      label: (label && String(label).trim()) || "Untitled key",
    });
    res.status(201).json({ ...key.toJSON(), key: fullKey });
  } catch (err) {
    next(err);
  }
});

router.get("/api-keys", requireAuth, async (req, res, next) => {
  try {
    const keys = await ApiKey.find({ userId: req.user.sub }).sort({ createdAt: -1 });
    res.json(keys.map((key) => key.toJSON()));
  } catch (err) {
    next(err);
  }
});

router.delete("/api-keys/:id", requireAuth, async (req, res, next) => {
  try {
    const key = await ApiKey.findOne({ _id: req.params.id, userId: req.user.sub });
    if (!key) return res.status(404).json({ error: "Key not found." });
    key.revokedAt = new Date();
    await key.save();
    res.json({ revoked: true });
  } catch (err) {
    next(err);
  }
});

router.get("/api-key-status", async (req, res, next) => {
  try {
    const rawKey = req.headers["x-api-key"];
    if (!rawKey || typeof rawKey !== "string") {
      return res.status(401).json({ error: "Missing x-api-key header." });
    }
    const key = await ApiKey.findOne({ keyHash: hashApiKey(rawKey) });
    if (!key || key.revokedAt) return res.status(401).json({ error: "Invalid or revoked API key." });

    const keyOwner = await User.findById(key.userId).select("isBlocked").lean();
    if (keyOwner?.isBlocked) {
      return res.status(403).json({ error: "This account has been suspended.", code: "ACCOUNT_BLOCKED" });
    }
    const apiSub = await ApiSubscription.findOne({ userId: key.userId });
    const entitlement = getApiEntitlement(apiSub);
    if (!entitlement.hasAccess) {
      return res.status(402).json({ error: "This account's API subscription isn't active — please update billing.", code: "UPGRADE_REQUIRED" });
    }
    ApiKey.updateOne({ _id: key.id }, { lastUsedAt: new Date() }).catch((err) =>
      console.error("Failed to update ApiKey.lastUsedAt:", err.message)
    );
    res.json({ ...entitlement, apiKeyId: key.id, userId: key.userId.toString() });
  } catch (err) {
    next(err);
  }
});

router.post("/api-usage", async (req, res, next) => {
  try {
    const rawKey = req.headers["x-api-key"];
    const { type } = req.body || {};
    if (!rawKey || typeof rawKey !== "string") return res.status(401).json({ error: "Missing x-api-key header." });
    if (type !== "segmented" && type !== "bgOnly") {
      return res.status(400).json({ error: 'type must be "segmented" or "bgOnly".' });
    }
    const key = await ApiKey.findOne({ keyHash: hashApiKey(rawKey) });
    if (!key || key.revokedAt) return res.status(401).json({ error: "Invalid or revoked API key." });
    const apiSub = await ApiSubscription.findOne({ userId: key.userId });
    if (!apiSub) return res.status(404).json({ error: "No API subscription found for this key's account." });

    const counterField = type === "segmented" ? "segmentedCount" : "bgOnlyCount";
    const updated = await ApiSubscription.findOneAndUpdate(
      { _id: apiSub._id },
      { $inc: { [`usage.${counterField}`]: 1 } },
      { new: true }
    );
    const usedAfter = updated.usage.segmentedCount + updated.usage.bgOnlyCount;
    const usedBefore = usedAfter - 1;
    const isOverage = isOverAllowance(updated, usedBefore);
    const overageCharged = isOverage
      ? await reportOverageUnit(updated, type, `${key.id}-${type}-${usedAfter}`)
      : false;

    res.json({
      recorded: true,
      type,
      usedThisPeriod: usedAfter,
      quota: updated.quota,
      rolloverCredits: updated.rolloverCredits || 0,
      allowance: typeof updated.quota === "number" ? updated.quota + (updated.rolloverCredits || 0) : null,
      billedAsOverage: isOverage,
      overageCharged,
    });
  } catch (err) {
    next(err);
  }
});

router.processPaystackEvent = async function processPaystackEvent(event) {
  const data = event.data || {};
  switch (event.event) {
    case "subscription.create":
      await applyPaystackSubscription(data);
      break;
    case "subscription.not_renew":
      await applyPaystackSubscription(data, { notRenewing: true });
      break;
    case "subscription.disable":
      await applyPaystackSubscription(data, { canceled: true });
      break;
    case "charge.success":
      await applySuccessfulCharge(data);
      break;
    case "invoice.payment_failed":
      await markSubscriptionPastDue(data);
      break;
    default:
      break;
  }
};

module.exports = router;
