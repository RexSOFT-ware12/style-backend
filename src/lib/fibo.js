/**
 * Fibo — FabricNow's in-house fabric & materials assistant, powered by OpenAI
 * (Chat Completions, JSON mode). Plain REST via global fetch; no SDK needed.
 * Uses the shared OPENAI_API_KEY. Model: OPENAI_FIBO_MODEL (default gpt-4o-mini).
 */
const { SITE_KNOWLEDGE } = require("./siteKnowledge");
const { chatJson } = require("./openaiClient");

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

function toMessages(contextBlock, ackJson, history, message, assistantWrap) {
  const msgs = [
    { role: "user", content: contextBlock },
    { role: "assistant", content: JSON.stringify(ackJson) },
  ];
  for (const turn of history) {
    if (!turn?.role || !turn?.text) continue;
    const isBot = turn.role === "assistant";
    msgs.push({ role: isBot ? "assistant" : "user", content: isBot ? JSON.stringify(assistantWrap(turn.text)) : String(turn.text).slice(0, 3000) });
  }
  msgs.push({ role: "user", content: message });
  return msgs;
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


async function askSiteAssistant({ taxonomies = {}, sampleProducts = [], history = [], message }) {
  const catalogSnapshot = {
    categories: taxonomies.categories || [],
    styles: taxonomies.styles || [],
    fabrics: taxonomies.fabrics || [],
    sampleProducts: sampleProducts.map((p) => ({ id: p.id, name: p.name, category: p.category, fabric: p.fabric, style: p.style, color: p.color, price: p.price })),
  };
  const knowledgeBlock =
    `FABRICNOW APPLICATION KNOWLEDGE BASE:\n${SITE_KNOWLEDGE}\n\n` +
    `LIVE CATALOG SNAPSHOT (current categories/styles/fabrics and a sample of real products):\n${JSON.stringify(catalogSnapshot, null, 2)}`;
  const raw = await chatJson({
    system: SITE_SYSTEM_INSTRUCTION,
    messages: toMessages(knowledgeBlock, { reply: "Got it — ready to help!" }, history, message, (t) => ({ reply: t })),
    maxTokens: 512,
  });
  return safeParseSiteJson(raw) || { reply: raw || "Sorry, I couldn't come up with an answer just now." };
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


async function askFibo({ product, candidates, history = [], message }) {
  const productContext = { id: product.id, name: product.name, fabric: product.fabric, style: product.style, color: product.color, price: product.price, description: product.description };
  const candidateContext = candidates.map((p) => ({ id: p.id, name: p.name, fabric: p.fabric, color: p.color, price: p.price }));
  const contextBlock =
    `CURRENT PRODUCT:\n${JSON.stringify(productContext, null, 2)}\n\n` +
    `OTHER FABRICS IN STOCK (candidates you may recommend from):\n${JSON.stringify(candidateContext, null, 2)}`;
  const raw = await chatJson({
    system: SYSTEM_INSTRUCTION,
    messages: toMessages(contextBlock, { reply: "Got it — ready to help!", recommend: [] }, history, message, (t) => ({ reply: t, recommend: [] })),
    maxTokens: 512,
  });
  return safeParseModelJson(raw) || { reply: raw || "Sorry, I couldn't come up with an answer just now.", recommend: [] };
}

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


async function askOnboardingPicks({ styles = [], experience = "", products = [] }) {
  const productContext = products.map((p) => ({ id: p.id, name: p.name, fabric: p.fabric, style: p.style, color: p.color, price: p.price }));
  const contextBlock =
    `NEW USER'S CHOICES:\n${JSON.stringify({ styles, experience }, null, 2)}\n\n` +
    `AVAILABLE PRODUCTS (pick only from these, by id):\n${JSON.stringify(productContext, null, 2)}`;
  const raw = await chatJson({ system: ONBOARDING_SYSTEM_INSTRUCTION, messages: [{ role: "user", content: contextBlock }], maxTokens: 512 });
  return safeParseOnboardingJson(raw) || { intro: "Welcome to FabricNow! Here are a few picks to get you started.", picks: [] };
}

module.exports = { askFibo, askSiteAssistant, askOnboardingPicks };
