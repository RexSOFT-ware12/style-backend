// Lookbooks: private CRUD for the workspace (/api/lookbooks) and the public share page (/l/:slug).
const express = require('express');
const { nanoid } = require('nanoid');
const { requireAuth } = require('../middleware/auth');
const { requireCompany, requirePermission } = require('../middleware/company');
const Lookbook = require('../models/Lookbook');
const { renderLookbookPage, THEMES } = require('../lib/lookbookPage');

const MAX_ITEMS = 30; const MAX_IMAGE = 1.5 * 1024 * 1024; const MAX_TOTAL = 12 * 1024 * 1024;
const CURRENCIES = /^[A-Z]{3}$/;
const clean = (v, n) => String(v ?? '').trim().slice(0, n);

function parseImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw Object.assign(new Error('Each lookbook item needs a JPG, PNG or WebP image.'), { status: 400 });
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_IMAGE) throw Object.assign(new Error('One of the images is too large. Keep each under 1.5 MB.'), { status: 413 });
  return { mime: m[1], data };
}

const baseUrl = (req) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

/* ---------- private ---------- */
const router = express.Router();
router.use(requireAuth, requireCompany);

router.get('/', requirePermission('collections:read'), async (req, res, next) => {
  try {
    const rows = await Lookbook.find({ companyId: req.company._id }).select('slug title brand createdAt items.name').sort({ createdAt: -1 }).limit(50);
    res.json({ lookbooks: rows.map((r) => ({ id: r._id.toString(), slug: r.slug, title: r.title, brand: r.brand, count: r.items.length, createdAt: r.createdAt, url: `${baseUrl(req)}/l/${r.slug}` })) });
  } catch (e) { next(e); }
});

router.post('/', requirePermission('collections:write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) return res.status(400).json({ error: 'Add at least one design to the lookbook.' });
    if (items.length > MAX_ITEMS) return res.status(400).json({ error: `A lookbook can hold up to ${MAX_ITEMS} designs.` });
    let total = 0;
    const parsed = items.map((it) => { const img = parseImage(it.image); total += img.data.length; return { name: clean(it.name, 120), price: clean(it.price, 24), note: clean(it.note, 300), ...img }; });
    if (total > MAX_TOTAL) return res.status(413).json({ error: 'The lookbook images are too large in total. Remove a few designs and try again.' });
    const lb = await Lookbook.create({
      companyId: req.company._id, userId: req.user.sub, slug: nanoid(10),
      title: clean(b.title, 120) || 'Lookbook', brand: clean(b.brand, 80), subtitle: clean(b.subtitle, 200),
      currency: CURRENCIES.test(b.currency) ? b.currency : 'USD', theme: THEMES[b.theme] ? b.theme : 'light', items: parsed,
    });
    res.status(201).json({ id: lb._id.toString(), slug: lb.slug, url: `${baseUrl(req)}/l/${lb.slug}` });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

router.delete('/:id', requirePermission('collections:write'), async (req, res, next) => {
  try {
    const r = await Lookbook.deleteOne({ _id: req.params.id, companyId: req.company._id });
    if (!r.deletedCount) return res.status(404).json({ error: 'Lookbook not found.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- public ---------- */
const pub = express.Router();
pub.get('/:slug', async (req, res, next) => {
  try {
    const lb = await Lookbook.findOne({ slug: req.params.slug });
    if (!lb) return res.status(404).type('text/plain').send('This lookbook is no longer available.');
    res.set({ 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.type('html').send(renderLookbookPage(lb));
  } catch (e) { next(e); }
});
pub.get('/:slug/img/:i', async (req, res, next) => {
  try {
    const lb = await Lookbook.findOne({ slug: req.params.slug }).select('items.mime items.data');
    const it = lb && lb.items[Number(req.params.i)];
    if (!it) return res.status(404).end();
    res.set({ 'Content-Type': it.mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.send(it.data);
  } catch (e) { next(e); }
});

module.exports = { router, pub };
