// Premium subscription: unlocks the Garment Tool, Pose Tool, and SVG
// customization once a user's 3-day free trial (stamped on signup — see
// models/User.js) has run out.
//
// Price: $29.99/mo for new subscribers as of 2026-09 (raised from $19.99
// now that it bundles three tools). Existing subscribers who joined before
// the raise are grandfathered at $19.99 — see lib/premiumPricing.js for how
// that's enforced (short version: we never move a live Stripe subscription
// to the new Price; STRIPE_PREMIUM_PRICE_ID just always points at whatever
// the CURRENT self-serve price is for brand-new Checkout sessions).
const express = require("express");
const User = require("../models/User");
const ApiKey = require("../models/ApiKey");
const ApiSubscription = require("../models/ApiSubscription");
const { requireAuth } = require("../middleware/auth");
const { getEntitlement } = require("../lib/entitlement");
const { getApiEntitlement } = require("../lib/apiEntitlement");
const { generateApiKey, hashApiKey } = require("../lib/apiKeyCrypto");
const { API_TIERS, isSelfServeTier, getTierConfig } = require("../lib/apiTiers");
const { reportOverageUnit } = require("../lib/stripeMeters");

const router = express.Router();

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;
const PREMIUM_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID; // Stripe Price for the $19.99-29.99/mo consumer plan

// Reverse lookup: Stripe base-price id -> our tier id, built from env vars
// declared in lib/apiTiers.js. Used by the webhook to tell "this event is
// about someone's API subscription" apart from the consumer Premium plan,
// and to know which tier a given subscription is on.
function getApiTierByBasePriceId(priceId) {
  if (!priceId) return null;
  for (const tier of Object.values(API_TIERS)) {
    if (tier.basePriceEnvVar && process.env[tier.basePriceEnvVar] === priceId) return tier.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/billing/status  (auth required)
// Drives the trial countdown / paywall UI across the account pages.
// ---------------------------------------------------------------------------
router.get("/status", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(getEntitlement(user));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/checkout  (auth required)
// Creates a Stripe Checkout Session in subscription mode for the premium
// plan, at whatever price STRIPE_PREMIUM_PRICE_ID currently points to
// (see lib/premiumPricing.js — this is always the CURRENT list price;
// existing subscribers are unaffected since this only fires for new
// Checkout sessions). Reuses an existing Stripe customer for this user if one
// already exists, so re-subscribing after a cancellation doesn't fragment
// their billing history across multiple customer records.
// ---------------------------------------------------------------------------
router.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    if (!stripe || !PREMIUM_PRICE_ID) {
      return res.status(500).json({
        error: "Premium subscriptions aren't configured yet. Set STRIPE_SECRET_KEY and STRIPE_PREMIUM_PRICE_ID.",
      });
    }

    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: user.stripeCustomerId,
      line_items: [{ price: PREMIUM_PRICE_ID, quantity: 1 }],
      success_url: `${FRONTEND_URL}/account?upgraded=1`,
      cancel_url: `${FRONTEND_URL}/account?canceled=1`,
      metadata: { userId: user.id },
      subscription_data: { metadata: { userId: user.id } },
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/portal  (auth required)
// Stripe's hosted Billing Portal — lets a subscriber update their card or
// cancel. Cancelling here (rather than us building a custom "cancel" button)
// means Stripe handles proration/end-of-period behavior for us.
// ---------------------------------------------------------------------------
router.post("/portal", requireAuth, async (req, res, next) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "Payments aren't configured yet." });
    }

    const user = await User.findById(req.user.sub);
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: "No billing account found for this user yet." });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${FRONTEND_URL}/account`,
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// API-access tiers (Garment Tool via API key) — separate product from the
// consumer Premium plan above. See lib/apiTiers.js for pricing/quota config.
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/billing/api-status  (auth required)
// Drives the "API access" section of the account dashboard: current tier,
// quota, usage this period, and a list of the user's keys (no secrets).
// ---------------------------------------------------------------------------
router.get("/api-status", requireAuth, async (req, res, next) => {
  try {
    const [apiSub, keys] = await Promise.all([
      ApiSubscription.findOne({ userId: req.user.sub }),
      ApiKey.find({ userId: req.user.sub }).sort({ createdAt: -1 }),
    ]);

    res.json({
      entitlement: getApiEntitlement(apiSub),
      keys: keys.map((k) => k.toJSON()),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/api-checkout  (auth required)
// body: { tier: "starter" | "growth" }
// Creates a Stripe Checkout Session for the chosen API tier: one flat
// licensed line item (the monthly base fee) plus two metered line items for
// overage (segmented / bg-only), billed at the shared per-image rates in
// lib/apiTiers.js regardless of tier. Metered Price line items must NOT have
// a `quantity` — Stripe reports their quantity via meter events instead
// (see lib/stripeMeters.js), not via Checkout.
//
// No self-serve path for "enterprise" — that's a negotiated deal, set up by
// hand (see scripts/setup-api-billing.js's notes).
// ---------------------------------------------------------------------------
router.post("/api-checkout", requireAuth, async (req, res, next) => {
  try {
    const { tier } = req.body || {};
    if (!isSelfServeTier(tier)) {
      return res.status(400).json({
        error: 'tier must be "starter" or "growth". For enterprise/custom volume, contact us directly.',
      });
    }

    if (!stripe) {
      return res.status(500).json({ error: "Payments aren't configured yet. Set STRIPE_SECRET_KEY." });
    }

    const tierConfig = getTierConfig(tier);
    const basePriceId = process.env[tierConfig.basePriceEnvVar];
    const overageSegmentedPriceId = process.env.STRIPE_API_OVERAGE_SEGMENTED_PRICE_ID;
    const overageBgOnlyPriceId = process.env.STRIPE_API_OVERAGE_BGONLY_PRICE_ID;
    if (!basePriceId || !overageSegmentedPriceId || !overageBgOnlyPriceId) {
      return res.status(500).json({
        error:
          "API billing isn't fully configured yet. Run scripts/setup-api-billing.js and set the printed env vars.",
      });
    }

    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });

    // A user might already have a stripeCustomerId from the consumer
    // Premium plan (routes above) — reuse it so this doesn't fragment
    // their billing history across two Stripe customers.
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    // Reject re-subscribing over an already-active API subscription —
    // send them to the billing portal instead to change tiers, rather
    // than risk two live subscriptions for the same product.
    const existing = await ApiSubscription.findOne({ userId: user.id });
    if (existing && ["active", "trialing", "past_due"].includes(existing.status)) {
      return res.status(400).json({
        error: "You already have an active API subscription. Use the billing portal to change tiers or cancel first.",
        code: "API_SUBSCRIPTION_EXISTS",
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: user.stripeCustomerId,
      line_items: [
        { price: basePriceId, quantity: 1 },
        { price: overageSegmentedPriceId }, // metered — no quantity
        { price: overageBgOnlyPriceId }, // metered — no quantity
      ],
      success_url: `${FRONTEND_URL}/account?apiUpgraded=1`,
      cancel_url: `${FRONTEND_URL}/account?apiCanceled=1`,
      metadata: { userId: user.id, apiTier: tier },
      subscription_data: { metadata: { userId: user.id, apiTier: tier } },
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/api-keys  (auth required)
// body: { label?: string }
// Generates a new API key. Requires an active (or trialing) ApiSubscription
// already in place — you get a key by subscribing first, not the other way
// around, so a key can never exist with nothing to bill it against.
// Returns the plaintext key ONCE; only its hash is ever stored.
// ---------------------------------------------------------------------------
router.post("/api-keys", requireAuth, async (req, res, next) => {
  try {
    const apiSub = await ApiSubscription.findOne({ userId: req.user.sub });
    const entitlement = getApiEntitlement(apiSub);
    if (!entitlement.hasAccess) {
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

    res.status(201).json({
      ...key.toJSON(),
      key: fullKey, // shown exactly once — the client must save this now
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/api-keys  (auth required)
// Lists the user's keys (prefix + metadata only, never the secret).
// ---------------------------------------------------------------------------
router.get("/api-keys", requireAuth, async (req, res, next) => {
  try {
    const keys = await ApiKey.find({ userId: req.user.sub }).sort({ createdAt: -1 });
    res.json(keys.map((k) => k.toJSON()));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/billing/api-keys/:id  (auth required)
// Revokes a key immediately (soft delete via revokedAt, so lastUsedAt/audit
// history sticks around). Scoped to req.user.sub so one user can't revoke
// another's key by guessing an id.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// GET /api/billing/api-key-status  (API key required, via x-api-key header)
// Called by garment-service's requireApiAccess middleware on every external
// API request — same "main backend is the single source of truth for
// entitlement" pattern as the consumer plan's /billing/status (see
// garment-service/src/middleware/requirePremium.js for that one).
// ---------------------------------------------------------------------------
router.get("/api-key-status", async (req, res, next) => {
  try {
    const rawKey = req.headers["x-api-key"];
    if (!rawKey || typeof rawKey !== "string") {
      return res.status(401).json({ error: "Missing x-api-key header." });
    }

    const key = await ApiKey.findOne({ keyHash: hashApiKey(rawKey) });
    if (!key || key.revokedAt) {
      return res.status(401).json({ error: "Invalid or revoked API key." });
    }

    const apiSub = await ApiSubscription.findOne({ userId: key.userId });
    const entitlement = getApiEntitlement(apiSub);

    if (!entitlement.hasAccess) {
      return res.status(402).json({
        error: "This account's API subscription isn't active — please update billing.",
        code: "UPGRADE_REQUIRED",
      });
    }

    // Fire-and-forget — don't make every processing request wait on this.
    ApiKey.updateOne({ _id: key.id }, { lastUsedAt: new Date() }).catch((err) =>
      console.error("Failed to update ApiKey.lastUsedAt:", err.message)
    );

    res.json({ ...entitlement, apiKeyId: key.id, userId: key.userId.toString() });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/api-usage  (API key required, via x-api-key header)
// body: { type: "segmented" | "bgOnly" }
// Called by garment-service ONCE per successfully processed image, after the
// fact — never blocks the user-facing response on this. Atomically
// increments this period's usage counter; if that push takes the account
// over its included quota, reports one billable unit to Stripe via
// lib/stripeMeters.js at the appropriate per-image overage rate.
// ---------------------------------------------------------------------------
router.post("/api-usage", async (req, res, next) => {
  try {
    const rawKey = req.headers["x-api-key"];
    const { type } = req.body || {};
    if (!rawKey || typeof rawKey !== "string") {
      return res.status(401).json({ error: "Missing x-api-key header." });
    }
    if (type !== "segmented" && type !== "bgOnly") {
      return res.status(400).json({ error: 'type must be "segmented" or "bgOnly".' });
    }

    const key = await ApiKey.findOne({ keyHash: hashApiKey(rawKey) });
    if (!key || key.revokedAt) {
      return res.status(401).json({ error: "Invalid or revoked API key." });
    }

    const apiSub = await ApiSubscription.findOne({ userId: key.userId });
    if (!apiSub) {
      return res.status(404).json({ error: "No API subscription found for this key's account." });
    }

    const counterField = type === "segmented" ? "segmentedCount" : "bgOnlyCount";

    // Atomic increment. Note: reading the pre-increment total off the
    // returned (post-increment) document to decide "was THIS call the one
    // that crossed the quota" is safe under normal load but not a hard
    // guarantee under heavy concurrent bursts right at the quota boundary —
    // a handful of calls landing in the same instant could all see
    // "still under quota" before any of their increments land. Given the
    // per-image overage amounts involved ($0.02-0.05), that's an acceptable
    // trade for not needing a distributed lock here; revisit if this ever
    // needs to be exact to the unit.
    const updated = await ApiSubscription.findOneAndUpdate(
      { _id: apiSub._id },
      { $inc: { [`usage.${counterField}`]: 1 } },
      { new: true }
    );

    const usedAfter = updated.usage.segmentedCount + updated.usage.bgOnlyCount;
    const usedBefore = usedAfter - 1;
    const isOverage = typeof updated.quota === "number" && usedBefore >= updated.quota;

    if (isOverage) {
      // Idempotency key: stable per (key, type, running count) so a retry
      // of this exact request never double-reports the same unit.
      const idempotencyKey = `${key.id}-${type}-${usedAfter}`;
      await reportOverageUnit(stripe, type, updated.stripeCustomerId, idempotencyKey);
    }

    res.json({ recorded: true, type, usedThisPeriod: usedAfter, quota: updated.quota, billedAsOverage: isOverage });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/webhook  (Stripe only — mounted with raw body in server.js)
// Keeps User.plan/subscriptionStatus in sync with what Stripe actually
// thinks is going on, which is the only source of truth for billing state.
// ---------------------------------------------------------------------------
router.post("/webhook", async (req, res) => {
  if (!stripe) return res.status(500).send("Stripe not configured");

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;

  let event;
  try {
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
      : JSON.parse(req.body.toString("utf8")); // dev fallback if no signing secret set yet
  } catch (err) {
    console.error("Billing webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      // Checkout finished — the subscription now exists, but we still wait
      // for customer.subscription.* below as the ongoing source of truth
      // for status (active/past_due/canceled/etc).
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;
        const userId = session.metadata?.userId;
        const user = userId
          ? await User.findById(userId)
          : await User.findOne({ stripeCustomerId: session.customer });
        if (user) {
          user.stripeCustomerId = session.customer;
          // Only the CONSUMER plan's Checkout session sets user.stripeSubscriptionId
          // here — an API-tier Checkout (session.metadata.apiTier set) is
          // tracked on ApiSubscription instead, handled below in the
          // customer.subscription.* cases (which is where we also learn the
          // subscription item ids, so there's nothing further to do here
          // for the API case besides making sure stripeCustomerId is saved).
          if (!session.metadata?.apiTier) {
            user.stripeSubscriptionId = session.subscription;
          }
          await user.save();
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;

        // Figure out which line item (if any) is one of our known API-tier
        // base prices — that's how we tell "this is an API subscription
        // event" apart from the consumer Premium plan, since both funnel
        // through the same webhook. Requires the subscription's items to be
        // expanded with price data, which they are by default on this event.
        const baseItem = subscription.items?.data?.find((item) => getApiTierByBasePriceId(item.price?.id));
        const apiTier = baseItem ? getApiTierByBasePriceId(baseItem.price.id) : null;

        if (apiTier) {
          const overageSegmentedId = process.env.STRIPE_API_OVERAGE_SEGMENTED_PRICE_ID;
          const overageBgOnlyId = process.env.STRIPE_API_OVERAGE_BGONLY_PRICE_ID;
          const overageSegmentedItem = subscription.items.data.find((i) => i.price?.id === overageSegmentedId);
          const overageBgOnlyItem = subscription.items.data.find((i) => i.price?.id === overageBgOnlyId);

          // Stripe API 2025-03-31.basil moved current_period_start/end off
          // the Subscription object and onto each SubscriptionItem — read
          // it off the base item specifically, since all three items on a
          // mixed licensed+metered subscription share the same period.
          const newPeriodStart = baseItem.current_period_start
            ? new Date(baseItem.current_period_start * 1000)
            : null;
          const newPeriodEnd = baseItem.current_period_end ? new Date(baseItem.current_period_end * 1000) : null;

          const userId = subscription.metadata?.userId;
          const existing = userId
            ? await ApiSubscription.findOne({ userId })
            : await ApiSubscription.findOne({ stripeSubscriptionId: subscription.id });

          // Reset this-period usage counters if the period has rolled over
          // since we last saw this subscription (new period start is later
          // than the period end we had stored) — a brand-new subscription
          // (existing === null) naturally starts at 0 via the schema default.
          const periodRolledOver =
            existing?.currentPeriodEnd && newPeriodStart && newPeriodStart.getTime() >= existing.currentPeriodEnd.getTime();

          await ApiSubscription.findOneAndUpdate(
            { userId: userId || existing?.userId },
            {
              $set: {
                tier: apiTier,
                status: subscription.status,
                stripeCustomerId: subscription.customer,
                stripeSubscriptionId: subscription.id,
                "stripeSubscriptionItemIds.base": baseItem.id,
                "stripeSubscriptionItemIds.overageSegmented": overageSegmentedItem?.id,
                "stripeSubscriptionItemIds.overageBgOnly": overageBgOnlyItem?.id,
                currentPeriodStart: newPeriodStart,
                currentPeriodEnd: newPeriodEnd,
                // Only set quota if this doc doesn't already have a custom
                // one (e.g. a hand-set enterprise quota) — plain tier
                // lookup for starter/growth.
                ...(existing?.quota == null ? { quota: getTierConfig(apiTier)?.quota ?? null } : {}),
                ...(periodRolledOver ? { "usage.segmentedCount": 0, "usage.bgOnlyCount": 0 } : {}),
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          break;
        }

        // Not an API-tier subscription — fall through to the existing
        // consumer Premium plan handling.
        const user = await User.findOne({
          $or: [{ stripeSubscriptionId: subscription.id }, { stripeCustomerId: subscription.customer }],
        });
        if (user) {
          user.stripeSubscriptionId = subscription.id;
          user.subscriptionStatus = subscription.status;
          user.plan = ["active", "trialing"].includes(subscription.status) ? "premium" : "free";

          // Cache the ACTUAL price this subscription bills, straight off
          // the Stripe object — never inferred from the current
          // STRIPE_PREMIUM_PRICE_ID env var, which may have since moved on
          // to a higher price for new signups. This is what makes
          // grandfathering work: a subscriber's cached price only changes
          // if their underlying Stripe subscription's price changes (e.g.
          // they cancel and re-subscribe at the new price, or explicitly
          // switch plans in the billing portal) — not just because the
          // env var did. The consumer plan only ever has one item on the
          // subscription, unlike the API tiers' base+overage bundle.
          const premiumItem = subscription.items?.data?.[0];
          if (premiumItem?.price) {
            user.premiumPriceId = premiumItem.price.id;
            user.premiumUnitAmountCents = premiumItem.price.unit_amount ?? null;
          }

          await user.save();
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;

        const apiSub = await ApiSubscription.findOne({ stripeSubscriptionId: subscription.id });
        if (apiSub) {
          apiSub.status = "canceled";
          await apiSub.save();
          break;
        }

        const user = await User.findOne({ stripeSubscriptionId: subscription.id });
        if (user) {
          user.subscriptionStatus = "canceled";
          user.plan = "free";
          await user.save();
        }
        break;
      }

      default:
        break; // ignore anything we don't act on
    }
  } catch (err) {
    console.error("Failed to process billing webhook:", err.message);
  }

  res.json({ received: true });
});

module.exports = router;
