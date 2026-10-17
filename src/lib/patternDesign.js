/**
 * AI helpers for the Pattern Library and the Fabric Library.
 *  - askPatternDesign: turns a description (and optionally a reference design or a photo) into a design SPEC.
 *    The app draws the flat sketch from that spec, so the model only ever picks from a fixed vocabulary.
 *  - askFabricFromImage: reads a photo of a fabric and fills in a fabric record.
 *  - makeFabricSwatch: asks the image model for a clean, flat, square swatch of the fabric in a photo.
 * Uses the same Gemini REST conventions as lib/gemini.js and lib/poseTool.js.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/* Must match src/pages/patterns/flats.js in the frontend. */
const VOCAB = {
  family: ['top', 'dress', 'skirt', 'trousers', 'jumpsuit'],
  fit: ['fitted', 'regular', 'boxy', 'oversized'],
  neckline: ['round', 'scoop', 'v', 'square', 'boat', 'sweetheart', 'collar', 'stand', 'funnel', 'hood', 'lapel'],
  sleeve: ['none', 'cap', 'short', 'elbow', 'three-quarter', 'long'],
  sleeveStyle: ['set-in', 'puff', 'bell', 'bishop', 'raglan', 'drop'],
  topLength: ['crop', 'waist', 'hip', 'tunic', 'long'],
  skirtLength: ['mini', 'knee', 'midi', 'maxi'],
  legLength: ['shorts', 'cropped', 'ankle', 'full'],
  skirt: ['straight', 'pencil', 'a-line', 'flared', 'gathered', 'mermaid', 'circle', 'wrap', 'tiered'],
  waist: ['seam', 'empire', 'drop', 'none', 'belt', 'elastic'],
  leg: ['straight', 'wide', 'tapered', 'flared'],
  closure: ['none', 'buttons', 'zip', 'wrap', 'tie'],
  pockets: ['none', 'patch', 'welt', 'kangaroo'],
  hem: ['straight', 'curved', 'peplum', 'bands'],
  details: ['embroidery', 'piping', 'slit', 'ruffle', 'yoke', 'pleats', 'cuffs'],
};
const CATEGORIES = ['tops', 'dresses', 'skirts', 'trousers', 'jackets', 'traditional'];
const lengthsFor = (family) => (family === 'top' ? VOCAB.topLength : family === 'trousers' || family === 'jumpsuit' ? VOCAB.legLength : VOCAB.skirtLength);
const pick = (v, list, d) => (list.includes(v) ? v : d);

function sanitizeSpec(s = {}) {
  s = s && typeof s === 'object' ? s : {};
  const family = pick(s.family, VOCAB.family, 'top');
  return {
    family,
    fit: pick(s.fit, VOCAB.fit, 'regular'),
    neckline: pick(s.neckline, VOCAB.neckline, 'round'),
    sleeve: pick(s.sleeve, VOCAB.sleeve, 'short'),
    sleeveStyle: pick(s.sleeveStyle, VOCAB.sleeveStyle, 'set-in'),
    length: pick(s.length, lengthsFor(family), family === 'top' ? 'hip' : family === 'trousers' || family === 'jumpsuit' ? 'full' : 'knee'),
    skirt: pick(s.skirt, VOCAB.skirt, 'a-line'),
    waist: pick(s.waist, VOCAB.waist, 'seam'),
    leg: pick(s.leg, VOCAB.leg, 'straight'),
    closure: pick(s.closure, VOCAB.closure, 'none'),
    pockets: pick(s.pockets, VOCAB.pockets, 'none'),
    hem: pick(s.hem, VOCAB.hem, 'straight'),
    details: Array.isArray(s.details) ? [...new Set(s.details.filter((x) => VOCAB.details.includes(x)))].slice(0, 5) : [],
  };
}
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function aiError(status, body) {
  const e = new Error(`Gemini API error ${status}: ${String(body).slice(0, 300)}`);
  e.status = status === 429 ? 429 : 503; e.code = 'AI_UNAVAILABLE';
  e.publicMessage = status === 429 ? 'The AI is busy right now. Please try again in a moment.' : 'The AI service is temporarily unavailable. Please try again shortly.';
  return e;
}
function parseDataUrl(src, maxChars = 4_000_000) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(src || ''));
  if (!m) { const e = new Error('Send the image as a JPEG, PNG or WebP.'); e.status = 400; e.publicMessage = e.message; throw e; }
  if (src.length > maxChars) { const e = new Error('That image is too large.'); e.status = 413; e.publicMessage = 'That image is too large. Try a smaller one.'; throw e; }
  return { mime: m[1], data: m[2] };
}
async function geminiText({ system, parts, maxTokens = 1500 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('GEMINI_API_KEY is not configured on the server'); e.status = 503; e.publicMessage = 'AI is not set up on this server yet.'; throw e; }
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45_000);
  try {
    const res = await fetch(`${BASE}/${GEMINI_MODEL}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json', temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    if (!res.ok) throw aiError(res.status, await res.text().catch(() => ''));
    const data = await res.json();
    const raw = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    const cleaned = raw.trim().replace(/^```json\s*|^```\s*|```$/g, '').trim();
    try { const out = JSON.parse(cleaned); if (!out || typeof out !== 'object') throw new Error('bad'); return out; }
    catch { const e = new Error('Unreadable AI response'); e.status = 502; e.publicMessage = 'The AI gave an answer we could not read. Please try again.'; throw e; }
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error('AI timed out'); t.status = 504; t.publicMessage = 'The AI took too long to answer. Please try again.'; throw t; }
    throw e;
  } finally { clearTimeout(timer); }
}

/* ---------------- pattern designs ---------------- */
const DESIGN_SYSTEM = `You are a fashion technical designer. You turn a request into a flat-sketch design spec.
You may ONLY use these values (copy them exactly):
${Object.entries(VOCAB).map(([k, v]) => `- ${k}: ${v.join(' | ')}`).join('\n')}
Rules:
- "length" depends on family: for top use ${VOCAB.topLength.join('/')}; for dress and skirt use ${VOCAB.skirtLength.join('/')}; for trousers and jumpsuit use ${VOCAB.legLength.join('/')}.
- Jackets, blazers, hoodies, cardigans and shirts are family "top". A kaftan or bubu is a "dress" with waist "none".
- Only set fields that matter for the family. Leave the rest at neutral values (sleeveStyle "set-in", closure "none", pockets "none", hem "straight", details []).
- If a reference design is given, start from it and change only what the request asks for.
- If a photo is given, describe the garment you can SEE. Do not guess hidden details.
Reply with ONLY JSON: {"name":"short design name","category":"tops|dresses|skirts|trousers|jackets|traditional","description":"one sentence","tags":["up to 4 lowercase words"],"spec":{...}}`;

async function askPatternDesign({ prompt = '', referenceSpec = null, referenceName = '', imageDataUrl = null, size = 'M' }) {
  const text = cleanText(prompt, 800);
  if (!text && !imageDataUrl) { const e = new Error('Describe the design or add a photo.'); e.status = 400; e.publicMessage = e.message; throw e; }
  const parts = [{ text: `REQUEST: ${text || '(no text, use the photo)'}\nSIZE: ${cleanText(size, 12)}${referenceSpec ? `\nREFERENCE DESIGN "${cleanText(referenceName, 80)}": ${JSON.stringify(sanitizeSpec(referenceSpec))}` : ''}` }];
  if (imageDataUrl) { const { mime, data } = parseDataUrl(imageDataUrl); parts.push({ inlineData: { mimeType: mime, data } }); }
  const out = await geminiText({ system: DESIGN_SYSTEM, parts, maxTokens: 900 });
  const spec = sanitizeSpec(out.spec);
  const fallbackCat = spec.family === 'dress' ? 'dresses' : spec.family === 'skirt' ? 'skirts' : spec.family === 'trousers' ? 'trousers' : spec.family === 'jumpsuit' ? 'dresses' : 'tops';
  return {
    name: cleanText(out.name, 80) || 'Untitled design',
    category: pick(out.category, CATEGORIES, fallbackCat),
    description: cleanText(out.description, 240),
    tags: (Array.isArray(out.tags) ? out.tags : []).map((t) => cleanText(t, 20).toLowerCase()).filter(Boolean).slice(0, 4),
    spec,
  };
}

/* ---------------- fabrics from a photo ---------------- */
const FABRIC_SYSTEM = `You are a textile expert helping a designer log a fabric from a photo.
Look only at what is visible. Be honest about uncertainty: give your best estimate and say it is an estimate in "notes".
Reply with ONLY JSON:
{"name":"short descriptive name, e.g. Indigo adire cotton","pattern":"print or weave name if you can tell (Ankara, Kente, Adire, Bogolan, Kitenge, Shweshwe, lace, stripe, plain...), else empty","color":"main colour name","composition":"best-guess fibre content or empty","weightGsm":number or null,"widthCm":null,"origin":"only if the print or weave clearly indicates one, else empty","palette":["#rrggbb up to 5 dominant colours"],"repeatCm":number or null,"suggestedUses":["up to 4 garment uses"],"notes":"1 to 2 sentences: handfeel/drape you would expect, plus that the details are AI estimates"}`;

async function askFabricFromImage(imageDataUrl, hint = '') {
  const { mime, data } = parseDataUrl(imageDataUrl);
  const parts = [{ text: `Describe this fabric for my library.${hint ? ` Designer's note: ${cleanText(hint, 200)}` : ''}` }, { inlineData: { mimeType: mime, data } }];
  const out = await geminiText({ system: FABRIC_SYSTEM, parts, maxTokens: 700 });
  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : undefined; };
  return {
    name: cleanText(out.name, 80) || 'Untitled fabric',
    pattern: cleanText(out.pattern, 60), color: cleanText(out.color, 40), composition: cleanText(out.composition, 80),
    weightGsm: num(out.weightGsm, 30, 700), widthCm: num(out.widthCm, 20, 400), origin: cleanText(out.origin, 60),
    palette: (Array.isArray(out.palette) ? out.palette : []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).map((c) => c.toLowerCase()).slice(0, 5),
    repeatCm: num(out.repeatCm, 1, 200),
    suggestedUses: (Array.isArray(out.suggestedUses) ? out.suggestedUses : []).map((u) => cleanText(u, 40)).filter(Boolean).slice(0, 4),
    notes: cleanText(out.notes, 400),
  };
}

/* Asks the image model for a clean square swatch. Returns { dataUrl } or { warning } (never throws for a missing image). */
async function makeFabricSwatch(imageDataUrl) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('GEMINI_API_KEY is not configured on the server'); e.status = 503; e.publicMessage = 'AI is not set up on this server yet.'; throw e; }
  const { mime, data } = parseDataUrl(imageDataUrl);
  const prompt = 'Recreate the fabric shown in this photo as a flat, evenly lit, perfectly square, front-on swatch that fills the whole frame. Keep the exact print, colours, scale of the motifs and weave. Remove folds, creases, shadows, hands, backgrounds and any text. Output one image only.';
  const call = (generationConfig) => fetch(`${BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mime, data } }] }], generationConfig }),
  });
  let res = await call({ responseModalities: ['TEXT', 'IMAGE'] });
  if (res.status === 400) res = await call(undefined);
  if (!res.ok) throw aiError(res.status, await res.text().catch(() => ''));
  const json = await res.json();
  const cand = json?.candidates?.[0], parts = cand?.content?.parts || [];
  const inline = (parts.find((p) => p.inlineData || p.inline_data) || {});
  const img = inline.inlineData || inline.inline_data;
  if (!img?.data) {
    const why = cand?.finishReason === 'SAFETY' || json?.promptFeedback?.blockReason ? 'The AI declined to redraw this image.' : "The AI didn't return a swatch this time.";
    return { warning: why };
  }
  return { dataUrl: `data:${img.mimeType || img.mime_type || 'image/png'};base64,${img.data}` };
}

module.exports = { VOCAB, CATEGORIES, sanitizeSpec, cleanText, parseDataUrl, askPatternDesign, askFabricFromImage, makeFabricSwatch };
