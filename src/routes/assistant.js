const express = require("express");
const Product = require("../models/Product");
const Taxonomy = require("../models/Taxonomy");
const { askFibo, askSiteAssistant, askOnboardingPicks } = require("../lib/gemini");
const { createRateLimiter } = require("../middleware/rateLimit");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Fibo calls a paid Gemini API and has no auth in front of it — throttle
// per-IP so a single client/script can't run up the bill. 12 requests/min
// is generous for a real chat session but blocks naive hammering.
const fiboRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 12,
  message: "Fibo is getting a lot of questions right now — please wait a moment and try again.",
});

// Same reasoning for the site-wide Live Chat widget, kept as its own bucket
// so heavy use of one doesn't throttle the other.
const siteChatRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 12,
  message: "Live chat is getting a lot of questions right now — please wait a moment and try again.",
});

// This one runs once per user right after signup, but it's still a paid
// Gemini call sitting behind auth rather than a form submit — a compromised
// or scripted account could otherwise hammer it. 6/min per IP is more than
// enough for a real onboarding session (which only ever calls it once) while
// keeping the ceiling low.
const onboardingRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 6,
  message: "Give it a moment — try continuing again shortly.",
});

function isValidObjectId(id) {
  return /^[a-f\d]{24}$/i.test(String(id));
}

// Public serializer for the small bits of product data Fibo/the client needs.
// (Kept intentionally slim — no reviews/digitalFile — this isn't the main
// product endpoint.)
function toSlim(product) {
  const obj = product.toJSON ? product.toJSON() : product;
  return {
    id: obj.id,
    name: obj.name,
    price: obj.price,
    image: obj.image,
    fabric: obj.fabric,
    color: obj.color,
    style: obj.style,
  };
}

// ---------------------------------------------------------------------------
// POST /api/assistant/ask
// Body: { productId: string, message: string, history?: {role, text}[] }
// Powers the "Fibo" chat widget on the storefront product page. Answers
// material/fabric questions grounded in the viewed product, and can suggest
// up to 3 other real in-stock products as alternatives.
// ---------------------------------------------------------------------------
router.post("/ask", fiboRateLimit, async (req, res, next) => {
  try {
    const { productId, message, history = [] } = req.body || {};

    if (!productId || !isValidObjectId(productId)) {
      return res.status(400).json({ error: "Valid productId is required" });
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }
    if (!Array.isArray(history) || history.length > 20) {
      return res.status(400).json({ error: "history must be an array of at most 20 turns" });
    }

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    // Candidate pool for recommendations: other products, preferring
    // different fabrics so Fibo has genuinely distinct alternatives to offer.
    const candidates = await Product.find({
      _id: { $ne: product._id },
      ...(product.fabric ? { fabric: { $ne: product.fabric } } : {}),
    })
      .limit(24)
      .select("name price image fabric color style");

    let fallbackCandidates = [];
    if (candidates.length < 6) {
      fallbackCandidates = await Product.find({ _id: { $ne: product._id } })
        .limit(24)
        .select("name price image fabric color style");
    }

    const candidatePool = (candidates.length ? candidates : fallbackCandidates).map(toSlim);

    const cleanHistory = history
      .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
      .slice(-10);

    const { reply, recommend } = await askFibo({
      product: toSlim(product),
      candidates: candidatePool,
      history: cleanHistory,
      message: message.trim().slice(0, 1000),
    });

    const byId = new Map(candidatePool.map((p) => [String(p.id), p]));
    const suggestions = recommend
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .slice(0, 3);

    res.json({ reply, suggestions });
  } catch (err) {
    if (err.message === "GEMINI_API_KEY is not configured on the server") {
      return res.status(503).json({ error: "Fibo isn't configured yet — missing GEMINI_API_KEY." });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/assistant/chat
// Body: { message: string, history?: {role, text}[] }
// Powers the site-wide "Live Chat" widget (e.g. the Live Chat button on
// /contact). Unlike /ask above, this isn't scoped to one product — it's
// grounded in FabricNow's whole-app knowledge base plus a live snapshot of
// the catalog, and can answer questions about any part of the application.
// ---------------------------------------------------------------------------
router.post("/chat", siteChatRateLimit, async (req, res, next) => {
  try {
    const { message, history = [] } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }
    if (!Array.isArray(history) || history.length > 20) {
      return res.status(400).json({ error: "history must be an array of at most 20 turns" });
    }

    const cleanHistory = history
      .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
      .slice(-10);

    const [taxonomyDocs, sampleProducts] = await Promise.all([
      Taxonomy.find({ active: true }).select("type name"),
      Product.find().sort({ featured: -1, createdAt: -1 }).limit(20).select("name price category fabric color style"),
    ]);

    const taxonomies = { categories: [], styles: [], fabrics: [] };
    for (const doc of taxonomyDocs) {
      if (doc.type === "category") taxonomies.categories.push(doc.name);
      if (doc.type === "style") taxonomies.styles.push(doc.name);
      if (doc.type === "fabric") taxonomies.fabrics.push(doc.name);
    }

    const { reply } = await askSiteAssistant({
      taxonomies,
      sampleProducts: sampleProducts.map(toSlim),
      history: cleanHistory,
      message: message.trim().slice(0, 1000),
    });

    res.json({ reply });
  } catch (err) {
    if (err.message === "GEMINI_API_KEY is not configured on the server") {
      return res.status(503).json({ error: "Live chat isn't configured yet — missing GEMINI_API_KEY." });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/assistant/onboarding  (auth required)
// Body: { styles: string[], experience: string }
// Powers the first-signup "Welcome" page: turns the couple of taps a new
// user just made into a short personalized note plus a shortlist of real
// products, via Gemini. Runs once per account (the frontend only calls this
// from /welcome), so it stays intentionally small in scope.
// ---------------------------------------------------------------------------
router.post("/onboarding", requireAuth, onboardingRateLimit, async (req, res, next) => {
  try {
    const { styles = [], experience = "" } = req.body || {};

    if (!Array.isArray(styles) || styles.some((s) => typeof s !== "string")) {
      return res.status(400).json({ error: "styles must be an array of strings" });
    }
    if (typeof experience !== "string") {
      return res.status(400).json({ error: "experience must be a string" });
    }

    const cleanStyles = styles.map((s) => s.trim()).filter(Boolean).slice(0, 5);
    const cleanExperience = experience.trim().slice(0, 40);

    // Prefer products matching the picked styles; fall back to featured/
    // recent ones so there's always something to show even for a style with
    // no exact catalog matches yet.
    let pool = [];
    if (cleanStyles.length) {
      pool = await Product.find({ style: { $in: cleanStyles } })
        .sort({ featured: -1, createdAt: -1 })
        .limit(30)
        .select("name price image fabric color style digitalFile category");
    }
    if (pool.length < 6) {
      const fallback = await Product.find({ _id: { $nin: pool.map((p) => p._id) } })
        .sort({ featured: -1, createdAt: -1 })
        .limit(30 - pool.length)
        .select("name price image fabric color style digitalFile category");
      pool = pool.concat(fallback);
    }

    const toCard = (p) => {
      const obj = p.toJSON ? p.toJSON() : p;
      return {
        id: obj.id,
        name: obj.name,
        price: obj.price,
        image: obj.image,
        fabric: obj.fabric,
        color: obj.color,
        style: obj.style,
        category: obj.category,
        hasDigitalFile: Boolean(obj.digitalFile),
      };
    };

    const cardPool = pool.map(toCard);

    const { intro, picks } = await askOnboardingPicks({
      styles: cleanStyles,
      experience: cleanExperience,
      products: cardPool,
    });

    const byId = new Map(cardPool.map((p) => [String(p.id), p]));
    const products = picks
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .slice(0, 6);

    // Gemini returned nothing usable — still give the page something to
    // show rather than an empty state.
    const finalProducts = products.length ? products : cardPool.slice(0, 6);

    res.json({ intro, products: finalProducts });
  } catch (err) {
    if (err.message === "GEMINI_API_KEY is not configured on the server") {
      return res.status(503).json({ error: "Onboarding picks aren't configured yet — missing GEMINI_API_KEY." });
    }
    next(err);
  }
});

module.exports = router;
