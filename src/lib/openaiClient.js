// Shared OpenAI REST helpers (Chat Completions + Images). Reads OPENAI_API_KEY at call time
// so a key changed from the admin dashboard takes effect without a restart.
const BASE = "https://api.openai.com/v1";
const MISSING = "OPENAI_API_KEY is not configured on the server";

function aiError(status, body) {
  const e = new Error(`OpenAI API error ${status}: ${String(body).slice(0, 300)}`);
  e.status = status === 429 ? 429 : 503;
  e.code = "AI_UNAVAILABLE";
  e.publicMessage = status === 429
    ? "The AI is busy right now. Please try again in a moment."
    : "The AI service is temporarily unavailable. Please try again shortly.";
  return e;
}
function key() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error(MISSING);
  return k;
}
async function post(path, body, timeoutMs = 60_000) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw aiError(res.status, await res.text().catch(() => ""));
  return res.json();
}

/** Chat completion in JSON mode. Returns the raw message text. */
async function chatJson({ system, messages, maxTokens = 512, model, timeoutMs }) {
  const data = await post("/chat/completions", {
    model: model || process.env.OPENAI_FIBO_MODEL || process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini",
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  }, timeoutMs);
  const msg = data?.choices?.[0]?.message;
  if (msg?.refusal) return "";
  return msg?.content || "";
}

module.exports = { post, chatJson, aiError, MISSING };
