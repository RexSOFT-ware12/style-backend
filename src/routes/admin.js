// Admin dashboard API. Everything under /api/admin is admin-only
// (requireAuth + requireAdmin — see middleware/auth.js); the server enforces
// this, the dashboard's hidden menu items are only cosmetic.
//
//   GET    /api/admin/overview
//   GET    /api/admin/users                      list users + their companies
//   GET    /api/admin/users/:id                  one user in full
//   POST   /api/admin/users/:id/block            { reason? }
//   POST   /api/admin/users/:id/unblock
//   POST   /api/admin/users/:id/api-subscription mark an API plan PAID by hand / record a renewal
//   POST   /api/admin/users/:id/api-credits      add or remove rollover credits
//   POST   /api/admin/users/:id/api-subscription/cancel
//   GET    /api/admin/companies
//   GET    /api/admin/provider-keys              OpenAI / Claude / Gemini / ... (masked)
//   PUT    /api/admin/provider-keys/:name        { value }
//   DELETE /api/admin/provider-keys/:name        back to the server default
//   POST   /api/admin/provider-keys/:name/test   { value? }
//   GET    /api/admin/audit
//
//   GET    /api/internal/provider-keys           (x-internal-secret) for garment-service
const express = require("express");
const crypto = require("crypto");
const User = require("../models/User");
const Company = require("../models/Company");
const CompanyMembership = require("../models/CompanyMembership");
const ApiSubscription = require("../models/ApiSubscription");
const ApiKey = require("../models/ApiKey");
const AdminAuditLog = require("../models/AdminAuditLog");
const { requireAuth, requireAdmin, clearStatusCache, isAdminStatus } = require("../middleware/auth");
const { getEntitlement } = require("../lib/entitlement");
const { getApiEntitlement } = require("../lib/apiEntitlement");
const { API_TIERS, getTierConfig } = require("../lib/apiTiers");
const { planManualPayment, rolloverOf } = require("../lib/apiCredits");
const { describeAll, setSecret, clearSecret } = require("../lib/secretsStore");
const { FIELD_BY_NAME, PROVIDER_GROUPS } = require("../lib/providerRegistry");
const { testProviderKey, canTest } = require("../lib/providerTest");

const router = express.Router();
const internalRouter = express.Router();

const isObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id));
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const httpError = (status, message, code) => Object.assign(new Error(message), { status, publicMessage: message, ...(code ? { code } : {}) });

async function audit(req, action, target, meta = {}) {
  try {
    await AdminAuditLog.create({
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action,
      targetUserId: target?._id && isObjectId(target._id) ? target._id : undefined,
      targetLabel: target?.email || target?.label || undefined,
      meta,
    });
  } catch (err) {
    console.error("Failed to write admin audit log:", err.message);
  }
}

async function loadTarget(req) {
  if (!isObjectId(req.params.id)) throw httpError(400, "Invalid user id.");
  const user = await User.findById(req.params.id);
  if (!user) throw httpError(404, "User not found.");
  return user;
}

// ---------------------------------------------------------------------------
// Internal (service-to-service) — NOT behind admin login. garment-service calls
// this with the shared secret so keys changed on the dashboard reach it too.
// ---------------------------------------------------------------------------
internalRouter.get("/provider-keys", (req, res) => {
  const expected = process.env.FABRIC_NOW_INTERNAL_SECRET;
  if (!expected || expected === "replace-with-a-long-random-secret") {
    return res.status(503).json({ error: "FABRIC_NOW_INTERNAL_SECRET isn't configured." });
  }
  const given = String(req.headers["x-internal-secret"] || "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  const out = {};
  for (const g of PROVIDER_GROUPS) {
    for (const f of g.fields) {
      if (f.sharedWithGarmentService && process.env[f.name]) out[f.name] = process.env[f.name];
    }
  }
  res.set("Cache-Control", "no-store");
  res.json({ keys: out });
});

// ---------------------------------------------------------------------------
// Everything below: admins only
// ---------------------------------------------------------------------------
router.use(requireAuth, requireAdmin);

router.get("/overview", async (req, res, next) => {
  try {
    const [users, blocked, companies, apiActive, apiManual] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isBlocked: true }),
      Company.countDocuments({}),
      ApiSubscription.countDocuments({ status: { $in: ["active", "trialing"] } }),
      ApiSubscription.countDocuments({ status: { $in: ["active", "trialing"] }, source: "manual" }),
    ]);
    res.json({ users, blocked, companies, apiActive, apiManual });
  } catch (err) {
    next(err);
  }
});

// ---- Users + companies ----------------------------------------------------

router.get("/users", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const q = String(req.query.q || "").trim().slice(0, 80);
    const status = String(req.query.status || "");

    const filter = {};
    if (status === "blocked") filter.isBlocked = true;
    if (status === "active") filter.isBlocked = { $ne: true };

    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      // Also match people by the NAME of a company they belong to.
      const companyIds = (await Company.find({ name: re }).select("_id").limit(200).lean()).map((c) => c._id);
      const memberIds = companyIds.length
        ? (await CompanyMembership.find({ companyId: { $in: companyIds } }).select("userId").lean()).map((m) => m.userId)
        : [];
      filter.$or = [{ name: re }, { email: re }, { companyName: re }, ...(memberIds.length ? [{ _id: { $in: memberIds } }] : [])];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("name email companyName plan subscriptionStatus isBlocked blockedReason role createdAt avatarUrl")
        .lean(),
    ]);

    const validIds = users.map((u) => u._id).filter(isObjectId);
    const [memberships, subs] = await Promise.all([
      CompanyMembership.find({ userId: { $in: validIds }, status: { $ne: "disabled" } }).lean(),
      ApiSubscription.find({ userId: { $in: validIds } }).lean(),
    ]);
    const companies = await Company.find({ _id: { $in: [...new Set(memberships.map((m) => String(m.companyId)))] } })
      .select("name slug")
      .lean();
    const companyById = new Map(companies.map((c) => [String(c._id), c]));
    const subByUser = new Map(subs.map((s) => [String(s.userId), s]));

    const rows = users.map((u) => {
      const uid = String(u._id);
      const sub = subByUser.get(uid);
      const ent = sub ? getApiEntitlement(sub) : null;
      return {
        id: uid,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl || null,
        companyName: u.companyName || "",
        plan: u.plan,
        subscriptionStatus: u.subscriptionStatus,
        isBlocked: !!u.isBlocked,
        blockedReason: u.blockedReason || "",
        isAdmin: isAdminStatus({ role: u.role, email: u.email }),
        createdAt: u.createdAt,
        companies: memberships
          .filter((m) => String(m.userId) === uid)
          .map((m) => {
            const c = companyById.get(String(m.companyId));
            return c ? { id: String(c._id), name: c.name, role: m.role } : null;
          })
          .filter(Boolean),
        api: ent && sub
          ? {
              tier: ent.tier,
              status: ent.status,
              source: ent.source,
              hasAccess: ent.hasAccess,
              allowance: ent.allowance,
              used: ent.used,
              remaining: ent.remaining,
              rolloverCredits: ent.rolloverCredits,
              currentPeriodEnd: ent.currentPeriodEnd,
            }
          : null,
      };
    });

    res.json({ total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), users: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/users/:id", async (req, res, next) => {
  try {
    const user = await loadTarget(req);
    const [memberships, sub, keys] = await Promise.all([
      CompanyMembership.find({ userId: user._id }).lean(),
      ApiSubscription.findOne({ userId: user._id }).lean(),
      ApiKey.find({ userId: user._id }).sort({ createdAt: -1 }).lean(),
    ]);
    const companies = await Company.find({ _id: { $in: memberships.map((m) => m.companyId) } }).lean();
    const cById = new Map(companies.map((c) => [String(c._id), c]));

    res.json({
      user: {
        ...user.toJSON(),
        isAdmin: isAdminStatus(user),
      },
      premium: getEntitlement(user),
      companies: memberships
        .map((m) => {
          const c = cById.get(String(m.companyId));
          return c
            ? { id: String(c._id), name: c.name, slug: c.slug, role: m.role, status: m.status, isOwner: String(c.ownerId) === String(user._id) }
            : null;
        })
        .filter(Boolean),
      api: {
        entitlement: getApiEntitlement(sub),
        manualPayment: sub?.manualPayment || null,
        keys: keys.map((k) => ({
          id: String(k._id),
          label: k.label,
          keyPrefix: k.keyPrefix,
          lastUsedAt: k.lastUsedAt || null,
          revokedAt: k.revokedAt || null,
          createdAt: k.createdAt,
        })),
      },
      tiers: Object.values(API_TIERS).map((t) => ({ id: t.id, label: t.label, monthlyPriceUsd: t.monthlyPriceUsd, quota: t.quota })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/block", async (req, res, next) => {
  try {
    const user = await loadTarget(req);
    if (String(user._id) === String(req.user.sub)) throw httpError(400, "You can't block your own account.");
    if (isAdminStatus(user)) throw httpError(400, "Admins can't be blocked. Remove their admin role first.");

    const reason = String(req.body?.reason || "").trim().slice(0, 300);
    user.isBlocked = true;
    user.blockedAt = new Date();
    user.blockedReason = reason || undefined;
    user.blockedBy = req.user.sub;
    await user.save();
    clearStatusCache(user._id);

    await audit(req, "user.block", user, { reason });
    res.json({ ok: true, isBlocked: true });
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/unblock", async (req, res, next) => {
  try {
    const user = await loadTarget(req);
    await User.updateOne(
      { _id: user._id },
      { $set: { isBlocked: false }, $unset: { blockedAt: "", blockedReason: "", blockedBy: "" } }
    );
    clearStatusCache(user._id);
    await audit(req, "user.unblock", user);
    res.json({ ok: true, isBlocked: false });
  } catch (err) {
    next(err);
  }
});

// ---- Manual API subscription (customer paid us directly) -------------------
//
// Use this the first time (turns the plan on) AND for every later month the
// customer pays directly (extends it). Credits behave exactly like a Stripe
// renewal: whatever is left over carries forward, the new month's credits are
// added on top.
router.post("/users/:id/api-subscription", async (req, res, next) => {
  try {
    const user = await loadTarget(req);
    const { tier, amountUsd, note } = req.body || {};
    const tierConfig = getTierConfig(tier);
    if (!tierConfig) throw httpError(400, 'tier must be "starter", "growth" or "enterprise".');

    const existing = await ApiSubscription.findOne({ userId: user._id });

    // Never stack a manual plan on top of a live Stripe subscription — the
    // customer would be billed twice.
    if (existing && existing.source !== "manual" && ["active", "trialing", "past_due"].includes(existing.status)) {
      throw httpError(
        409,
        "This customer has a live Stripe API subscription. Cancel it in Stripe first, otherwise they'd be charged twice.",
        "STRIPE_SUBSCRIPTION_LIVE"
      );
    }

    // Quota: the tier default, or an explicit number (required for enterprise).
    let quota;
    if (req.body.quota !== undefined && req.body.quota !== null && req.body.quota !== "") {
      quota = Number(req.body.quota);
      if (!Number.isFinite(quota) || quota < 0 || quota > 10_000_000 || !Number.isInteger(quota)) {
        throw httpError(400, "quota must be a whole number of images per month.");
      }
    } else if (tier === "enterprise") {
      throw httpError(400, "Enter the monthly image quota for this enterprise customer.");
    } else {
      quota = tierConfig.quota;
    }

    let amount;
    if (amountUsd !== undefined && amountUsd !== null && amountUsd !== "") {
      amount = Number(amountUsd);
      if (!Number.isFinite(amount) || amount < 0) throw httpError(400, "amountUsd must be a positive number.");
    }

    const now = new Date();
    const switchingTier = !!existing && existing.tier !== tier;
    const plan = planManualPayment(existing, quota, now, { forceFresh: switchingTier });

    const set = {
      tier,
      status: "active",
      source: "manual",
      quota,
      ...plan.set,
      manualPayment: {
        amountUsd: amount,
        note: String(note || "").trim().slice(0, 500) || undefined,
        recordedBy: req.user.sub,
        recordedAt: now,
      },
    };
    // Detach any old (canceled) Stripe subscription so a late Stripe webhook
    // for it can never flip this manual plan back to canceled.
    const update = { $set: set, $unset: { stripeSubscriptionId: "", stripeSubscriptionItemIds: "" } };

    // No setDefaultsOnInsert on purpose: it would try to default the whole
    // `usage` object while we $set usage.* fields, which MongoDB rejects as a
    // path conflict. Every field a new plan needs is set explicitly above.
    const sub = await ApiSubscription.findOneAndUpdate({ userId: user._id }, update, { upsert: true, new: true });

    await audit(req, "api.manual_payment", user, {
      tier,
      quota,
      amountUsd: amount ?? null,
      mode: plan.mode,
      periodEnd: sub.currentPeriodEnd,
      rolloverCredits: sub.rolloverCredits,
    });

    res.status(plan.mode === "new" ? 201 : 200).json({ ok: true, mode: plan.mode, entitlement: getApiEntitlement(sub) });
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/api-credits", async (req, res, next) => {
  try {
    const user = await loadTarget(req);
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      throw httpError(400, "amount must be a whole number (use a negative number to remove credits).");
    }
    const sub = await ApiSubscription.findOne({ userId: user._id });
    if (!sub) throw httpError(404, "This user has no API subscription yet. Mark a plan as paid first.");

    sub.rolloverCredits = Math.max(0, rolloverOf(sub) + amount);
    await sub.save();

    await audit(req, "api.credits_adjust", user, {
      amount,
      note: String(req.body?.note || "").slice(0, 300),
      rolloverCredits: sub.rolloverCredits,
    });
    res.json({ ok: true, entitlement: getApiEntitlement(sub) });
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/api-subscription/cancel", async (req, res, next) => {
  try {
    const user = await loadTarget(req);
    const sub = await ApiSubscription.findOne({ userId: user._id });
    if (!sub) throw httpError(404, "No API subscription found.");
    if (sub.source !== "manual") {
      throw httpError(400, "This plan is billed through Stripe — cancel it from Stripe (or the customer's billing portal) so billing stops too.");
    }
    sub.status = "canceled"; // unused credits stay on the account for if they come back
    await sub.save();
    await audit(req, "api.manual_cancel", user, { tier: sub.tier });
    res.json({ ok: true, entitlement: getApiEntitlement(sub) });
  } catch (err) {
    next(err);
  }
});

// ---- Companies ---------------------------------------------------------------

router.get("/companies", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const q = String(req.query.q || "").trim().slice(0, 80);
    const filter = q ? { name: new RegExp(escapeRegex(q), "i") } : {};

    const [total, companies] = await Promise.all([
      Company.countDocuments(filter),
      Company.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    const ids = companies.map((c) => c._id);
    const [counts, owners] = await Promise.all([
      CompanyMembership.aggregate([
        { $match: { companyId: { $in: ids }, status: "active" } },
        { $group: { _id: "$companyId", members: { $sum: 1 } } },
      ]),
      User.find({ _id: { $in: companies.map((c) => c.ownerId).filter(isObjectId) } }).select("name email isBlocked").lean(),
    ]);
    const countBy = new Map(counts.map((c) => [String(c._id), c.members]));
    const ownerBy = new Map(owners.map((o) => [String(o._id), o]));

    res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      companies: companies.map((c) => {
        const o = ownerBy.get(String(c.ownerId));
        return {
          id: String(c._id),
          name: c.name,
          slug: c.slug,
          createdAt: c.createdAt,
          members: countBy.get(String(c._id)) || 0,
          owner: o ? { id: String(o._id), name: o.name, email: o.email, isBlocked: !!o.isBlocked } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// ---- Provider keys (OpenAI, Claude, Gemini, ...) ---------------------------------

router.get("/provider-keys", async (req, res, next) => {
  try {
    const groups = await describeAll();
    for (const g of groups) for (const f of g.fields) f.testable = canTest(f.name);
    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

router.put("/provider-keys/:name", async (req, res, next) => {
  try {
    const name = req.params.name;
    if (!FIELD_BY_NAME.has(name)) throw httpError(404, "Unknown setting.");
    await setSecret(name, req.body?.value, req.user.sub);
    await audit(req, "provider_key.set", { label: name }, { name }); // never log the value
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 400) err.publicMessage = err.message;
    next(err);
  }
});

router.delete("/provider-keys/:name", async (req, res, next) => {
  try {
    const name = req.params.name;
    if (!FIELD_BY_NAME.has(name)) throw httpError(404, "Unknown setting.");
    await clearSecret(name);
    await audit(req, "provider_key.clear", { label: name }, { name });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/provider-keys/:name/test", async (req, res, next) => {
  try {
    const name = req.params.name;
    if (!FIELD_BY_NAME.has(name)) throw httpError(404, "Unknown setting.");
    const typed = req.body?.value ? String(req.body.value).trim() : "";
    res.json(await testProviderKey(name, typed || process.env[name]));
  } catch (err) {
    next(err);
  }
});

// ---- Audit trail ---------------------------------------------------------------

router.get("/audit", async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const rows = await AdminAuditLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({
      entries: rows.map((r) => ({
        id: String(r._id),
        action: r.action,
        actor: r.actorEmail,
        target: r.targetLabel || null,
        meta: r.meta || {},
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, internalRouter };
