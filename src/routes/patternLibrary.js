const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireCompany, requirePermission } = require('../middleware/company');
const { createRateLimiter } = require('../middleware/rateLimit');
const PatternDesign = require('../models/PatternDesign');
const { CATEGORIES, sanitizeSpec, cleanText, askPatternDesign } = require('../lib/patternDesign');

const router = express.Router();
router.use(requireAuth, requireCompany);
const cid = (req) => req.company._id, uid = (req) => req.user.sub;
const MAX_DESIGNS = 500, SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const aiLimit = createRateLimiter({ windowMs: 60_000, max: 12, message: 'You are generating designs quickly. Please wait a minute and try again.' });

const body = (b = {}) => {
  const out = {};
  if (b.name !== undefined) out.name = cleanText(b.name, 120);
  if (b.category !== undefined && CATEGORIES.includes(b.category)) out.category = b.category;
  if (b.description !== undefined) out.description = cleanText(b.description, 600);
  if (b.notes !== undefined) out.notes = cleanText(b.notes, 2000);
  if (b.tags !== undefined) out.tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => cleanText(t, 20).toLowerCase()).filter(Boolean).slice(0, 8);
  if (b.spec !== undefined) out.spec = sanitizeSpec(b.spec);
  if (b.sizeLabel !== undefined && SIZES.includes(b.sizeLabel)) out.sizeLabel = b.sizeLabel;
  if (b.favorite !== undefined) out.favorite = !!b.favorite;
  return out;
};
async function ensureRoom(req, res) {
  if (await PatternDesign.countDocuments({ companyId: cid(req), status: 'active' }) >= MAX_DESIGNS) {
    res.status(400).json({ error: `Your library is full (${MAX_DESIGNS} designs). Delete some to add more.` }); return false;
  }
  return true;
}

router.get('/', async (req, res, next) => {
  try { res.json({ designs: await PatternDesign.find({ companyId: cid(req), status: 'active' }).sort({ updatedAt: -1 }).limit(MAX_DESIGNS) }); } catch (e) { next(e); }
});

/* Create from a spec: used by "Duplicate" on a starter design and by manual saves. */
router.post('/', requirePermission('assets:write'), async (req, res, next) => {
  try {
    const d = body(req.body);
    if (!d.name) return res.status(400).json({ error: 'Give the design a name.' });
    if (!d.spec) return res.status(400).json({ error: 'The design is missing its sketch details.' });
    if (!(await ensureRoom(req, res))) return;
    const source = ['starter', 'duplicate', 'manual'].includes(req.body.source) ? (req.body.source === 'starter' ? 'duplicate' : req.body.source) : 'manual';
    res.status(201).json({ design: await PatternDesign.create({ category: 'tops', ...d, source, companyId: cid(req), createdBy: uid(req) }) });
  } catch (e) { next(e); }
});

router.put('/:id', requirePermission('assets:write'), async (req, res, next) => {
  try {
    const d = await PatternDesign.findOneAndUpdate({ _id: req.params.id, companyId: cid(req), status: 'active' }, { $set: body(req.body) }, { new: true });
    d ? res.json({ design: d }) : res.status(404).json({ error: 'Design not found.' });
  } catch (e) { next(e); }
});

router.delete('/:id', requirePermission('assets:write'), async (req, res, next) => {
  try {
    const d = await PatternDesign.findOneAndUpdate({ _id: req.params.id, companyId: cid(req) }, { $set: { status: 'archived' } });
    d ? res.json({ ok: true }) : res.status(404).json({ error: 'Design not found.' });
  } catch (e) { next(e); }
});

router.post('/:id/duplicate', requirePermission('assets:write'), async (req, res, next) => {
  try {
    const src = await PatternDesign.findOne({ _id: req.params.id, companyId: cid(req), status: 'active' });
    if (!src) return res.status(404).json({ error: 'Design not found.' });
    if (!(await ensureRoom(req, res))) return;
    const copy = await PatternDesign.create({
      companyId: cid(req), createdBy: uid(req), name: cleanText(`${src.name} copy`, 120), category: src.category, description: src.description,
      tags: src.tags, spec: src.spec, sizeLabel: src.sizeLabel, notes: src.notes, source: 'duplicate',
    });
    res.status(201).json({ design: copy });
  } catch (e) { next(e); }
});

/* Describe a design (optionally from a reference design and/or a photo) and the AI fills in the spec. */
router.post('/ai', requirePermission('assets:write'), aiLimit, async (req, res, next) => {
  try {
    const { prompt, referenceId, referenceSpec, referenceName, imageDataUrl } = req.body || {};
    const size = SIZES.includes(req.body?.size) ? req.body.size : 'M';
    let refSpec = null, refName = '';
    if (referenceId && /^[a-f0-9]{24}$/i.test(String(referenceId))) {
      const ref = await PatternDesign.findOne({ _id: referenceId, companyId: cid(req) });
      if (ref) { refSpec = ref.spec; refName = ref.name; }
    } else if (referenceSpec && typeof referenceSpec === 'object') { refSpec = sanitizeSpec(referenceSpec); refName = cleanText(referenceName, 80); }
    if (!(await ensureRoom(req, res))) return;
    const made = await askPatternDesign({ prompt, referenceSpec: refSpec, referenceName: refName, imageDataUrl: imageDataUrl || null, size });
    const design = await PatternDesign.create({
      ...made, companyId: cid(req), createdBy: uid(req), source: imageDataUrl ? 'photo' : 'ai', prompt: cleanText(prompt, 1000), sizeLabel: size,
    });
    res.status(201).json({ design });
  } catch (e) {
    if (e.publicMessage) return res.status(e.status || 500).json({ error: e.publicMessage });
    next(e);
  }
});

module.exports = router;
