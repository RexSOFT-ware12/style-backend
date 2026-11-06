// "AI stylist" for the 3D try-on. OpenAI never places any geometry: it only picks a handful of fit settings
// (silhouette, ease, hem flare, folds) from a short description of the pattern. The browser clamps every value
// again (garmentFit.cleanStyle), so a bad answer can never push the cloth into the body.
const URL = "https://api.openai.com/v1/chat/completions";
const SILHOUETTES = ["pencil", "a-line", "gathered", "flared"];
const num = (v, a, b) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : undefined; };

function cleanStyle(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {};
  if (SILHOUETTES.includes(r.silhouette)) out.silhouette = r.silhouette;
  const set = (k, a, b, round) => { const n = num(r[k], a, b); if (n !== undefined) out[k] = round ? Math.round(n) : n; };
  set("roundness", 0, 1); set("hemFlare", 0, 0.25); set("foldCount", 0, 16, true); set("foldDepth", 0, 0.08);
  set("easeBust", 0.02, 0.15); set("easeWaist", 0.02, 0.15); set("easeHip", 0.02, 0.2);
  return out;
}

const SYSTEM = `You are a fashion technician choosing how a garment should hang on a body in a 3D preview.
You get a short description of a sewing pattern (garment type, circumferences in cm, length, fabric).
Reply with ONE JSON object and nothing else, using only these keys:
- silhouette: "pencil" | "a-line" | "gathered" | "flared"
- roundness: 0-1. How round the skirt becomes below the hip (fitted skirts about 0.2-0.4, full skirts 0.8-1).
- hemFlare: 0-0.25. Extra outward swing at the hem (0 for fitted, more for light, full, flowing fabric).
- foldCount: 0-16. Number of soft folds around the skirt (0 for smooth/stiff or fitted).
- foldDepth: 0-0.08. How deep the folds are (light drapey fabric deeper, stiff fabric shallower).
- easeBust, easeWaist, easeHip: 0.02-0.2. Extra room as a fraction (0.02 very close, 0.1 relaxed).
Base the choice on the pattern's fullness (hem circumference vs hip), the length, and what the fabric would really do:
cotton/wax/ankara prints hold some shape, chiffon/silk/satin drape and fold, denim/brocade stay stiff.
Never explain. JSON only.`;

const cache = new Map(); // description -> style, so the same pattern is never asked twice
async function askDrapeStyle(summary) {
  const key = JSON.stringify(summary).slice(0, 4000);
  if (cache.has(key)) return { style: cache.get(key), source: "cache" };
  // Render env values are often pasted with quotes or a trailing newline, which OpenAI answers with a 401.
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!apiKey) { console.warn("[drape-style] OPENAI_API_KEY is not set on this server"); return { style: null, source: "default", reason: "OPENAI_API_KEY is not configured" }; }
  if (!apiKey.startsWith("sk-")) console.warn("[drape-style] OPENAI_API_KEY does not start with sk- ; check it was pasted correctly");
  const started = Date.now();
  const wanted = process.env.OPENAI_DRAPE_MODEL || process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini";
  const attempt = (model, json) => fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model, temperature: 0.2, max_tokens: 220,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: key }],
    }),
  });
  let res;
  try {
    res = await attempt(wanted, true);
    if (res.status === 400) res = await attempt(wanted, false);                                   // some models refuse JSON mode
    if (res.status === 404 && wanted !== "gpt-4o-mini") res = await attempt("gpt-4o-mini", true); // unknown model name in the env
  } catch (e) {
    console.warn(`[drape-style] OpenAI could not be reached: ${e?.message || e}`);
    return { style: null, source: "default", reason: "OpenAI could not be reached" };
  }
  if (!res.ok) {
    let detail = "";
    try { const e = await res.json(); detail = String(e?.error?.message || e?.error?.code || "").slice(0, 160); } catch { /* no body */ }
    console.warn(`[drape-style] OpenAI ${res.status}: ${detail}`);
    return { style: null, source: "default", reason: `OpenAI returned ${res.status}${detail ? ` (${detail})` : ""}` };
  }
  let parsed = {};
  try {
    const data = await res.json();
    const text = String(data.choices?.[0]?.message?.content || "");
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1) || "{}");
  } catch { /* fall through to default */ }
  const style = cleanStyle(parsed);
  if (!Object.keys(style).length) { console.warn(`[drape-style] OpenAI answered but nothing usable (model ${wanted})`); return { style: null, source: "default", reason: "No usable answer" }; }
  console.log(`[drape-style] ok model=${wanted} ${Date.now() - started}ms silhouette=${style.silhouette || "-"}`);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, style);
  return { style, source: "openai" };
}

module.exports = { askDrapeStyle, cleanStyle };