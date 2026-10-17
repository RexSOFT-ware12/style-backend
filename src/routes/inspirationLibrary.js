const express = require('express');
const InspirationLibrary = require('../models/InspirationLibrary');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth); // any signed-in user of any company; no company scoping

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/inspiration-library?gender=&category=&region=&type=&q=&page=&limit=
router.get('/', async (req, res, next) => {
  try {
    const { gender, category, region, type, q } = req.query;
    const filter = { active: true };
    if (gender) filter.gender = { $in: [String(gender), 'unisex'] };
    if (category) filter.category = String(category);
    if (region) filter.region = new RegExp(esc(region), 'i');
    if (type) filter.type = String(type);
    if (q) { const rx = new RegExp(esc(q), 'i'); filter.$or = [{ title: rx }, { style: rx }, { tags: rx }]; }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const [items, total] = await Promise.all([
      InspirationLibrary.find(filter).sort({ type: 1, seedId: 1 }).skip((page - 1) * limit).limit(limit),
      InspirationLibrary.countDocuments(filter),
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { next(e); }
});

// GET /api/inspiration-library/facets — values for filter dropdowns
router.get('/facets', async (_req, res, next) => {
  try {
    const [categories, regions, genders] = await Promise.all([
      InspirationLibrary.distinct('category', { active: true }),
      InspirationLibrary.distinct('region', { active: true }),
      InspirationLibrary.distinct('gender', { active: true }),
    ]);
    res.json({ categories: categories.sort(), regions: regions.sort(), genders });
  } catch (e) { next(e); }
});


// ---- Free photo search: Unsplash (default) or Pexels ----
// Set UNSPLASH_ACCESS_KEY (https://unsplash.com/developers) or PEXELS_API_KEY.
// PHOTO_PROVIDER=unsplash|pexels forces one when both are set.
// Unsplash rules: show photographer + Unsplash credit (UTM links), hotlink their
// image URLs (we do), and ping the download endpoint when a photo is actually used.
const APP_NAME = process.env.UNSPLASH_APP_NAME || 'fabricnow';
const photoCache = new Map(); // key -> { at, body }
const PHOTO_TTL = 10 * 60 * 1000; // 10 min, protects the hourly quota

function activeProvider() {
  const want = String(process.env.PHOTO_PROVIDER || '').toLowerCase();
  if (want === 'unsplash' && process.env.UNSPLASH_ACCESS_KEY) return 'unsplash';
  if (want === 'pexels' && process.env.PEXELS_API_KEY) return 'pexels';
  if (process.env.UNSPLASH_ACCESS_KEY) return 'unsplash';
  if (process.env.PEXELS_API_KEY) return 'pexels';
  return null;
}
const utm = (u) => { try { const x = new URL(u); x.searchParams.set('utm_source', APP_NAME); x.searchParams.set('utm_medium', 'referral'); return x.toString(); } catch { return u; } };

async function searchUnsplash({ q, page, limit, orientation }) {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', q);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(Math.min(limit, 30)));
  url.searchParams.set('content_filter', 'high');
  if (orientation) url.searchParams.set('orientation', orientation === 'square' ? 'squarish' : orientation);
  const r = await fetch(url, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(8000) });
  if (r.status === 429 || r.status === 403) return { status: 429 };
  if (!r.ok) return { status: 502 };
  const d = await r.json();
  return {
    total: d.total || 0,
    hasMore: page < (d.total_pages || 0),
    attribution: { text: 'Photos from Unsplash', url: utm('https://unsplash.com') },
    items: (d.results || []).map((p) => ({
      id: String(p.id),
      title: p.alt_description || p.description || q,
      imageUrl: p.urls?.regular || p.urls?.small || '',
      thumbUrl: p.urls?.small || p.urls?.thumb || '',
      width: p.width, height: p.height, color: p.color || '',
      photographer: p.user?.name || '',
      photographerUrl: utm(p.user?.links?.html || 'https://unsplash.com'),
      link: utm(p.links?.html || 'https://unsplash.com'),
      source: 'Unsplash', sourceUrl: utm('https://unsplash.com'),
    })),
  };
}

async function searchPexels({ q, page, limit, orientation }) {
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', q);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(Math.min(limit, 40)));
  if (orientation) url.searchParams.set('orientation', orientation);
  const r = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY }, signal: AbortSignal.timeout(8000) });
  if (r.status === 429) return { status: 429 };
  if (!r.ok) return { status: 502 };
  const d = await r.json();
  return {
    total: d.total_results || 0,
    hasMore: Boolean(d.next_page),
    attribution: { text: 'Photos provided by Pexels', url: 'https://www.pexels.com' },
    items: (d.photos || []).map((p) => ({
      id: String(p.id),
      title: p.alt || q,
      imageUrl: p.src?.large || p.src?.medium || '',
      thumbUrl: p.src?.medium || p.src?.small || '',
      width: p.width, height: p.height, color: p.avg_color || '',
      photographer: p.photographer || '',
      photographerUrl: p.photographer_url || '',
      link: p.url,
      source: 'Pexels', sourceUrl: 'https://www.pexels.com',
    })),
  };
}

// GET /api/inspiration-library/photos?q=&page=&limit=&orientation=
router.get('/photos', async (req, res, next) => {
  try {
    const provider = activeProvider();
    if (!provider) return res.json({ configured: false, items: [], total: 0, page: 1, hasMore: false });
    const q = String(req.query.q || 'African fashion').trim().slice(0, 100) || 'African fashion';
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 40);
    const orientation = ['portrait', 'landscape', 'square'].includes(req.query.orientation) ? req.query.orientation : '';
    const key = [provider, q.toLowerCase(), page, limit, orientation].join('|');
    const hit = photoCache.get(key);
    if (hit && Date.now() - hit.at < PHOTO_TTL) return res.json(hit.body);

    const out = await (provider === 'unsplash' ? searchUnsplash : searchPexels)({ q, page, limit, orientation });
    if (out.status === 429) return res.status(429).json({ error: 'Photo search is busy right now. Try again in a few minutes.' });
    if (out.status) return res.status(502).json({ error: 'Photo search is unavailable right now.' });
    const body = { configured: true, provider, query: q, page, total: out.total, hasMore: out.hasMore, attribution: out.attribution, items: out.items };
    if (photoCache.size > 200) photoCache.delete(photoCache.keys().next().value);
    photoCache.set(key, { at: Date.now(), body });
    res.json(body);
  } catch (e) { next(e); }
});

// POST /api/inspiration-library/photos/download  { id, source }
// Unsplash requires a ping when a photo is actually used (saved / sent to Studio).
router.post('/photos/download', express.json(), async (req, res) => {
  try {
    const { id, source } = req.body || {};
    if (String(source).toLowerCase() !== 'unsplash' || !process.env.UNSPLASH_ACCESS_KEY) return res.json({ ok: true, skipped: true });
    if (!/^[\w-]{5,40}$/.test(String(id))) return res.status(400).json({ error: 'Bad photo id.' });
    await fetch(`https://api.unsplash.com/photos/${id}/download`, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }, signal: AbortSignal.timeout(5000) });
    res.json({ ok: true });
  } catch { res.json({ ok: true, skipped: true }); } // never block the user on a tracking ping
});

module.exports = router;
