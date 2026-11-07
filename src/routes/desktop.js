// Endpoints for the FabricNow v2 DESKTOP app (Automation Studio), authenticated
// with a developer API key — see middleware/requireApiKey.js.
//
//   GET  /api/desktop/whoami      sign-in check: account, plan, quota
//   POST /api/desktop/assistant   AI assistant (runs on the server's OpenAI key,
//                                 so the desktop app never holds a provider key)
//   GET  /api/desktop/clo-policy  the CLO licence statement the app shows/records
//
// The assistant only RETURNS TEXT. Nothing it proposes runs on the server; the
// desktop app shows every proposed action/script for the user to approve.
const express = require("express");
const { requireApiKey } = require("../middleware/requireApiKey");

const router = express.Router();

const MODEL = process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini";
const MAX_MESSAGES = 20, MAX_CONTENT = 8000, MAX_SYSTEM = 20000;
const WINDOW_MS = 60_000, MAX_PER_WINDOW = Number(process.env.DESKTOP_ASSISTANT_PER_MIN || 10);

// Per-API-key limiter (the shared limiter in middleware/rateLimit.js is per-IP).
const hits = new Map();
function perKeyLimit(req, res, next) {
  const id = req.apiKey?.id || "anon", now = Date.now();
  const list = (hits.get(id) || []).filter((t) => t > now - WINDOW_MS);
  list.push(now); hits.set(id, list);
  if (hits.size > 5000) hits.clear();
  if (list.length > MAX_PER_WINDOW) {
    res.set("Retry-After", String(WINDOW_MS / 1000));
    return res.status(429).json({ error: "Too many assistant requests — wait a minute and try again.", code: "RATE_LIMITED" });
  }
  next();
}

const CLO_POLICY = {
  version: "2026-11",
  summary:
    "FabricNow automation runs on YOUR computer, inside YOUR licensed copy of CLO, for your own business use. " +
    "FabricNow does not provide, host or sublicense CLO. Do not share FabricNow's CLO bridge script or any script " +
    "that calls the CLO API with other companies or people, and do not run CLO on a server for others.",
  source: "CLO Additional Terms §3.2 and §5.1.2 (legal.clo-set.com/additional-clo)",
};

router.get("/clo-policy", (_req, res) => res.json(CLO_POLICY));

router.get("/whoami", requireApiKey, (req, res) => {
  const e = req.apiEntitlement;
  res.json({
    user: { id: req.user.sub, email: req.user.email, name: req.user.name },
    key: req.apiKey,
    plan: { tier: e.tier, status: e.status, quota: e.quota, used: e.used, remaining: e.remaining,
            allowance: e.allowance, currentPeriodEnd: e.currentPeriodEnd },
    assistant: { available: !!process.env.OPENAI_API_KEY, provider: "openai", model: MODEL },
    cloPolicy: CLO_POLICY,
  });
});

function validate(body) {
  const { messages, system } = body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return "messages must be 1–20 items.";
  for (const m of messages) {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || !m.content.trim() || m.content.length > MAX_CONTENT)
      return "Each message needs role user|assistant and text content up to 8000 characters.";
  }
  if (messages[messages.length - 1].role !== "user") return "The last message must be from the user.";
  if (system != null && (typeof system !== "string" || system.length > MAX_SYSTEM)) return "system must be text up to 20000 characters.";
  return null;
}

router.post("/assistant", requireApiKey, perKeyLimit, async (req, res, next) => {
  try {
    const bad = validate(req.body);
    if (bad) return res.status(400).json({ error: bad, code: "BAD_REQUEST" });
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "The assistant is not configured on this server.", code: "ASSISTANT_UNAVAILABLE" });

    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 60_000);
    let r;
    try {
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", signal: ctl.signal,
        headers: { "content-type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: MODEL, max_tokens: 4096,
                               messages: [...(req.body.system ? [{ role: "system", content: req.body.system }] : []),
                                          ...req.body.messages.map(({ role, content }) => ({ role, content }))] }),
      });
    } finally { clearTimeout(timer); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("desktop assistant upstream error", r.status, data?.error?.type);
      return res.status(502).json({ error: "The assistant is temporarily unavailable.", code: "ASSISTANT_UPSTREAM" });
    }
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({ error: "The assistant returned an empty response.", code: "ASSISTANT_EMPTY_RESPONSE" });
    }
    res.json({ reply: reply.trim(), model: data.model || MODEL });
  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ error: "The assistant timed out.", code: "ASSISTANT_TIMEOUT" });
    next(err);
  }
});

module.exports = router;
