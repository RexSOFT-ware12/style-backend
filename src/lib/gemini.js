/**
 * Thin wrapper around the Gemini API for "Fibo" — FabricNow's in-house
 * fabric & materials assistant. Uses the plain REST endpoint (no SDK
 * dependency needed since Node 22 has global fetch).
 */
const { SITE_KNOWLEDGE } = require("./siteKnowledge");

// Google retired gemini-2.0-flash; the current fast/cheap model on the
// generateContent REST endpoint is gemini-3.6-flash. Override via
// GEMINI_MODEL in .env if your account is on a different one.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `You are Fibo, the friendly in-house fabric & materials expert for FabricNow, an online fabric/textile store.

Your job on the product page:
- Answer shopper questions about the CURRENT product's material: what it's made of, feel/hand, breathability, durability, stretch, care/washing instructions, best uses (e.g. garments, upholstery, quilting), pros/cons vs other fibers, sustainability, etc.
- Keep answers short, warm, and concrete (2-5 sentences). No walls of text.
- Only use facts given to you in the product context below. If you don't know something specific (like an exact thread count), say so honestly instead of inventing it — general textile knowledge is fine, but don't invent numbers about THIS product.
- If the shopper's question implies the current fabric isn't quite right for them (e.g. they want something cooler, cheaper, stretchier, warmer, more durable, vegan, etc.), recommend up to 3 better-fitting alternatives ONLY from the "Other fabrics in stock" list below, by their id. Only recommend when it genuinely helps — don't force a recommendation into every answer.
- Never invent products, ids, prices, or stock that isn't in the provided lists.
- Stay on topic: fabrics, materials, and this store's products. Politely redirect if asked something unrelated.

You MUST reply with ONLY a raw JSON object (no markdown fences, no commentary outside the JSON) in exactly this shape:
{"reply": "your conversational answer as plain text", "recommend": ["<productId>", "..."]}

"recommend" must be an array of ids copied verbatim from the "Other fabrics in stock" list (or an empty array if no recommendation fits).`;

// System instruction for the site-wide "Live Chat" widget (as opposed to
// Fibo-on-a-product-page above). This assistant is grounded ONLY in
// FabricNow's own site knowledge + live catalog snapshot passed in below,
// and is explicitly told to stay inside that scope.
const SITE_SYSTEM_INSTRUCTION = `You are Fibo, FabricNow's live chat assistant. FabricNow is a store selling downloadable studio-quality fabric assets and CLO3D garment files.

You have been given, below, a knowledge base describing the ENTIRE FabricNow application: every page, how orders/downloads/accounts/licensing/returns work, and a live snapshot of the current catalog (categories, styles, fabrics, and a sample of real products). Use ONLY this information plus the conversation history to answer.

Rules:
- Answer questions about FabricNow the application: how to buy, download, re-download, use files in CLO3D, licensing/commercial use, account/billing, returns/refund exceptions, where to find something on the site, company info, and the product catalog.
- Keep answers short, warm, and concrete (2-5 sentences). No walls of text.
- Only state facts that are in the knowledge base below or in general CLO3D/textile knowledge; never invent prices, policies, order details, or product specifics that aren't provided.
- If asked about a specific order, account, or payment (things that require looking up private data), explain that you can't access personal account/order details in this chat, and point them to My Purchases or to contact support with their order number.
- If asked something entirely unrelated to FabricNow and its application (general trivia, coding help, other companies, etc.), politely decline and steer the conversation back to how you can help with FabricNow.

You MUST reply with ONLY a raw JSON object (no markdown fences, no commentary outside the JSON) in exactly this shape:
{"reply": "your conversational answer as plain text"}`;

function buildSiteContents({ knowledgeBlock, history, message }) {
  const contents = [];

  contents.push({ role: "user", parts: [{ text: knowledgeBlock }] });
  contents.push({
    role: "model",
    parts: [{ text: JSON.stringify({ reply: "Got it — ready to help!" }) }],
  });

  for (const turn of history) {
    if (!turn?.role || !turn?.text) continue;
    contents.push({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.role === "assistant" ? JSON.stringify({ reply: turn.text }) : turn.text }],
    });
  }

  contents.push({ role: "user", parts: [{ text: message }] });

  return contents;
}

function safeParseSiteJson(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^```json\s*|^```\s*|```$/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.reply !== "string") return null;
    return { reply: parsed.reply };
  } catch {
    return null;
  }
}

/**
 * Ask Fibo Live Chat — the site-wide assistant grounded in SITE_KNOWLEDGE
 * plus a live snapshot of the catalog (taxonomies + sample products),
 * rather than in a single product.
 *
 * @param {object} params
 * @param {{categories?: string[], styles?: string[], fabrics?: string[]}} params.taxonomies
 * @param {object[]} params.sampleProducts - a handful of real, current products
 * @param {{role: "user"|"assistant", text: string}[]} params.history
 * @param {string} params.message
 * @returns {Promise<{reply: string}>}
 */
async function askSiteAssistant({ taxonomies = {}, sampleProducts = [], history = [], message }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server");
  }

  const catalogSnapshot = {
    categories: taxonomies.categories || [],
    styles: taxonomies.styles || [],
    fabrics: taxonomies.fabrics || [],
    sampleProducts: sampleProducts.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      fabric: p.fabric,
      style: p.style,
      color: p.color,
      price: p.price,
    })),
  };

  const knowledgeBlock =
    `FABRICNOW APPLICATION KNOWLEDGE BASE:\n${SITE_KNOWLEDGE}\n\n` +
    `LIVE CATALOG SNAPSHOT (current categories/styles/fabrics and a sample of real products):\n${JSON.stringify(
      catalogSnapshot,
      null,
      2
    )}`;

  const body = {
    system_instruction: { parts: [{ text: SITE_SYSTEM_INSTRUCTION }] },
    contents: buildSiteContents({ knowledgeBlock, history, message }),
    generationConfig: {
      maxOutputTokens: 512,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const parsed = safeParseSiteJson(raw);

  if (!parsed) {
    return { reply: raw || "Sorry, I couldn't come up with an answer just now." };
  }

  return parsed;
}

function buildContents({ product, candidates, history, message }) {
  const productContext = {
    id: product.id,
    name: product.name,
    fabric: product.fabric,
    style: product.style,
    color: product.color,
    price: product.price,
    description: product.description,
  };

  const candidateContext = candidates.map((p) => ({
    id: p.id,
    name: p.name,
    fabric: p.fabric,
    color: p.color,
    price: p.price,
  }));

  const contextBlock =
    `CURRENT PRODUCT:\n${JSON.stringify(productContext, null, 2)}\n\n` +
    `OTHER FABRICS IN STOCK (candidates you may recommend from):\n${JSON.stringify(
      candidateContext,
      null,
      2
    )}`;

  const contents = [];

  // Ground the conversation with product context as the first turn.
  contents.push({ role: "user", parts: [{ text: contextBlock }] });
  contents.push({
    role: "model",
    parts: [{ text: JSON.stringify({ reply: "Got it — ready to help!", recommend: [] }) }],
  });

  for (const turn of history) {
    if (!turn?.role || !turn?.text) continue;
    contents.push({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.role === "assistant" ? JSON.stringify({ reply: turn.text, recommend: [] }) : turn.text }],
    });
  }

  contents.push({ role: "user", parts: [{ text: message }] });

  return contents;
}

function safeParseModelJson(raw) {
  if (!raw) return null;
  // Strip markdown fences defensively, in case the model adds them anyway.
  const cleaned = raw.trim().replace(/^```json\s*|^```\s*|```$/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.reply !== "string") return null;
    return {
      reply: parsed.reply,
      recommend: Array.isArray(parsed.recommend) ? parsed.recommend.map(String) : [],
    };
  } catch {
    return null;
  }
}

/**
 * @param {object} params
 * @param {object} params.product - the product being viewed (serialized)
 * @param {object[]} params.candidates - other products eligible for recommendation
 * @param {{role: "user"|"assistant", text: string}[]} params.history - prior turns, oldest first
 * @param {string} params.message - the shopper's new question
 * @returns {Promise<{reply: string, recommend: string[]}>}
 */
async function askFibo({ product, candidates, history = [], message }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server");
  }

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: buildContents({ product, candidates, history, message }),
    generationConfig: {
      // temperature/top_p/top_k are deprecated on Gemini 3.x — leave sampling
      // at the model's own defaults instead of overriding it.
      maxOutputTokens: 512,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const parsed = safeParseModelJson(raw);

  if (!parsed) {
    // Fall back to showing the raw text rather than failing the request outright.
    return { reply: raw || "Sorry, I couldn't come up with an answer just now.", recommend: [] };
  }

  return parsed;
}

// System instruction for the first-signup onboarding picks. Distinct from
// Fibo (product-page) and Live Chat (whole-app support) — this one only
// ever runs once, right after signup, to turn a couple of taps into a
// personalized first impression of the catalog.
const ONBOARDING_SYSTEM_INSTRUCTION = `You are Fibo, FabricNow's in-house fabric & materials expert, welcoming a brand-new user right after they signed up.

They just told you (a) which styles they design in and (b) their experience level with CLO3D. Your job:
- Write a short, warm, genuinely specific welcome note (2-3 sentences) that reacts to their actual choices — not a generic greeting. Mention the style(s) or experience level by name naturally.
- If they're a beginner, reassure them briefly that the Garment Tool / Pose Tool make CLO3D-ready files easy to get started with.
- Pick up to 6 products from the "AVAILABLE PRODUCTS" list below that best match their stated styles. Prefer variety (different fabrics/colors) over near-duplicates. If fewer than 6 genuinely fit, return fewer — never pad with irrelevant picks.
- Never invent products, ids, or prices not in the list.

You MUST reply with ONLY a raw JSON object (no markdown fences, no commentary outside the JSON) in exactly this shape:
{"intro": "your welcome note as plain text", "picks": ["<productId>", "..."]}`;

function safeParseOnboardingJson(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^```json\s*|^```\s*|```$/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.intro !== "string") return null;
    return {
      intro: parsed.intro,
      picks: Array.isArray(parsed.picks) ? parsed.picks.map(String) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Personalizes the first-signup onboarding flow: given the styles/experience
 * level a new user just picked, returns a short welcome note plus a
 * shortlist of real product ids to feature.
 *
 * @param {object} params
 * @param {string[]} params.styles - style names the user picked (e.g. ["Streetwear"])
 * @param {string} params.experience - e.g. "beginner" | "some-experience" | "pro"
 * @param {object[]} params.products - candidate pool (slim product objects)
 * @returns {Promise<{intro: string, picks: string[]}>}
 */
async function askOnboardingPicks({ styles = [], experience = "", products = [] }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server");
  }

  const productContext = products.map((p) => ({
    id: p.id,
    name: p.name,
    fabric: p.fabric,
    style: p.style,
    color: p.color,
    price: p.price,
  }));

  const contextBlock =
    `NEW USER'S CHOICES:\n${JSON.stringify({ styles, experience }, null, 2)}\n\n` +
    `AVAILABLE PRODUCTS (pick only from these, by id):\n${JSON.stringify(productContext, null, 2)}`;

  const body = {
    system_instruction: { parts: [{ text: ONBOARDING_SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: contextBlock }] }],
    generationConfig: {
      maxOutputTokens: 512,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const parsed = safeParseOnboardingJson(raw);

  if (!parsed) {
    return { intro: "Welcome to FabricNow! Here are a few picks to get you started.", picks: [] };
  }

  return parsed;
}

module.exports = { askFibo, askSiteAssistant, askOnboardingPicks };
