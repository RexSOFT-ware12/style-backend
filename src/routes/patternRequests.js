const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PatternRequest = require('../models/PatternRequest');
const User = require('../models/User');
const ApiSubscription = require('../models/ApiSubscription');
const { getApiEntitlement } = require('../lib/apiEntitlement');
const { isOverAllowance } = require('../lib/apiCredits');
const { reportOverageUnit } = require('../lib/paystackOverages');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();
const ROOT = path.resolve(process.env.PATTERN_REQUEST_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'pattern-requests'));
fs.mkdirSync(ROOT, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ROOT),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
});
const imageUpload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024, files: 2 }, fileFilter: (_req, f, cb) => cb(/^image\/(png|jpe?g|webp)$/i.test(f.mimetype) ? null : new Error('Upload JPG, PNG or WebP images.'), /^image\/(png|jpe?g|webp)$/i.test(f.mimetype)) });
const resultUpload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024, files: 21 }, fileFilter: (_req, f, cb) => { const ok = f.fieldname === 'file' ? (/\.zip$/i.test(f.originalname) || f.mimetype === 'application/zip') : f.fieldname === 'previews' && /^image\/(png|jpe?g|webp)$/i.test(f.mimetype); cb(ok ? null : new Error(f.fieldname === 'file' ? 'Upload a ZIP file.' : 'Pattern previews must be PNG, JPG or WebP images.'), ok); } });
const safe = (r) => ({ id: String(r._id), title: r.title, garment: r.garment, lining: r.lining, notes: r.notes, formats: r.formats, extraCuts: r.extraCuts, status: r.status, adminNote: r.adminNote, createdAt: r.createdAt, updatedAt: r.updatedAt, completedAt: r.completedAt, sourceImageUrl: `/api/pattern-requests/${r._id}/source`, swatchImageUrl: r.swatchImage ? `/api/pattern-requests/${r._id}/swatch` : null, resultZipName: r.resultZipName, hasDownload: !!r.resultZip, previews: (r.previewImages || []).map((p, i) => ({ index: i, name: p.name, url: `/api/pattern-requests/${r._id}/previews/${i}` })) });
const sendStored = (res, file, name) => { if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'File not found.' }); res.download(file, name || path.basename(file)); };
router.post('/', requireAuth, imageUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'swatch', maxCount: 1 }]), async (req, res, next) => {
  try {
    const image = req.files?.file?.[0]; if (!image) return res.status(400).json({ error: 'A garment photo is required.' });
    // Manual production requests still consume one API Growth image-equivalent unit.
    // They do not call OpenAI; this is the workspace's metered production-request allowance.
    const sub = await ApiSubscription.findOne({ userId: req.user.sub });
    const entitlement = getApiEntitlement(sub);
    if (!entitlement.hasAccess) {
      for (const f of [...(req.files?.file || []), ...(req.files?.swatch || [])]) fs.unlink(f.path, () => {});
      return res.status(402).json({ error: 'An active API subscription is required to submit a manual pattern request.', code: 'API_SUBSCRIPTION_REQUIRED' });
    }
    const variants = (() => { try { return JSON.parse(req.body.variants || '{}'); } catch { return {}; } })();
    const r = await PatternRequest.create({ userId: req.user.sub, title: String(req.body.title || req.body.garment || 'Garment pattern request').slice(0, 140), garment: String(req.body.garment || 'Not specified').slice(0, 120), lining: String(req.body.lining || 'none'), notes: String(req.body.notes || '').slice(0, 5000), formats: Array.isArray(variants.formats) ? variants.formats : [], extraCuts: !!variants.extraCuts, sourceImage: image.path, sourceImageName: image.originalname, swatchImage: req.files?.swatch?.[0]?.path || '', swatchImageName: req.files?.swatch?.[0]?.originalname || '' });
    try {
      const updated = await ApiSubscription.findOneAndUpdate(
        { _id: sub._id },
        { $inc: { 'usage.segmentedCount': 1 } },
        { new: true }
      );
      const usedAfter = (updated.usage?.segmentedCount || 0) + (updated.usage?.bgOnlyCount || 0);
      const usedBefore = usedAfter - 1;
      const billedAsOverage = isOverAllowance(updated, usedBefore);
      const overageCharged = billedAsOverage
        ? await reportOverageUnit(updated, 'segmented', `manual-pattern-${r._id}`)
        : false;
      return res.status(201).json({
        request: safe(r), message: 'Your garment request has been submitted.',
        usage: { imagesDeducted: 1, usedThisPeriod: usedAfter, quota: updated.quota, rolloverCredits: updated.rolloverCredits || 0, billedAsOverage, overageCharged },
      });
    } catch (usageError) {
      await PatternRequest.deleteOne({ _id: r._id }).catch(() => {});
      for (const f of [...(req.files?.file || []), ...(req.files?.swatch || [])]) fs.unlink(f.path, () => {});
      throw usageError;
    }
  } catch (e) { next(e); }
});
router.get('/mine', requireAuth, async (req, res, next) => { try { const rows = await PatternRequest.find({ userId: req.user.sub }).sort({ createdAt: -1 }).limit(100); res.json({ requests: rows.map(safe) }); } catch (e) { next(e); } });
router.get('/:id', requireAuth, async (req, res, next) => { try { const r = await PatternRequest.findOne({ _id: req.params.id, userId: req.user.sub }); if (!r) return res.sendStatus(404); res.json({ request: safe(r) }); } catch (e) { next(e); } });
router.get('/:id/source', requireAuth, async (req, res, next) => { try { const r = await PatternRequest.findById(req.params.id); if (!r || (String(r.userId) !== String(req.user.sub) && req.userStatus?.role !== 'admin')) return res.sendStatus(404); sendStored(res, r.sourceImage, r.sourceImageName); } catch (e) { next(e); } });
router.get('/:id/swatch', requireAuth, async (req, res, next) => { try { const r = await PatternRequest.findById(req.params.id); if (!r || (String(r.userId) !== String(req.user.sub) && req.userStatus?.role !== 'admin')) return res.sendStatus(404); sendStored(res, r.swatchImage, r.swatchImageName); } catch (e) { next(e); } });
router.get('/:id/previews/:index', requireAuth, async (req, res, next) => { try { const r = await PatternRequest.findOne({ _id: req.params.id, userId: req.user.sub }); const p = r?.previewImages?.[Number(req.params.index)]; if (!p) return res.sendStatus(404); res.sendFile(path.resolve(p.path)); } catch (e) { next(e); } });
router.get('/:id/download', requireAuth, async (req, res, next) => { try { const r = await PatternRequest.findById(req.params.id); if (!r || String(r.userId) !== String(req.user.sub) || r.status !== 'completed') return res.sendStatus(404); sendStored(res, r.resultZip, r.resultZipName || 'fabricnow-pattern.zip'); } catch (e) { next(e); } });
router.get('/admin/list', requireAuth, requireAdmin, async (req, res, next) => { try { const filter = req.query.status && req.query.status !== 'all' ? { status: req.query.status } : {}; const rows = await PatternRequest.find(filter).sort({ createdAt: -1 }).limit(250).lean(); const ids = [...new Set(rows.map(x => String(x.userId)))]; const users = await User.find({ _id: { $in: ids } }).select('name email').lean(); const byId = new Map(users.map(u => [String(u._id), u])); res.json({ requests: rows.map(r => ({ ...safe(r), customer: byId.get(String(r.userId)) || {} })) }); } catch (e) { next(e); } });
router.get('/admin/:id/source', requireAuth, requireAdmin, async (req, res, next) => { try { const r = await PatternRequest.findById(req.params.id); if (!r) return res.sendStatus(404); sendStored(res, r.sourceImage, r.sourceImageName); } catch (e) { next(e); } });
router.get('/admin/:id/swatch', requireAuth, requireAdmin, async (req, res, next) => { try { const r = await PatternRequest.findById(req.params.id); if (!r) return res.sendStatus(404); sendStored(res, r.swatchImage, r.swatchImageName); } catch (e) { next(e); } });
router.get('/admin/:id/previews/:index', requireAuth, requireAdmin, async (req, res, next) => { try { const r = await PatternRequest.findById(req.params.id); const p = r?.previewImages?.[Number(req.params.index)]; if (!p) return res.sendStatus(404); res.sendFile(path.resolve(p.path)); } catch (e) { next(e); } });
router.patch('/admin/:id/status', requireAuth, requireAdmin, express.json(), async (req, res, next) => { try { const allowed = ['submitted', 'processing', 'revision_requested']; if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' }); const r = await PatternRequest.findByIdAndUpdate(req.params.id, { status: req.body.status, adminNote: String(req.body.adminNote || '').slice(0, 2000) }, { new: true }); if (!r) return res.sendStatus(404); res.json({ request: safe(r) }); } catch (e) { next(e); } });
router.post('/admin/:id/result', requireAuth, requireAdmin, resultUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'previews', maxCount: 20 }]), async (req, res, next) => { try { const f = req.files?.file?.[0]; if (!f) return res.status(400).json({ error: 'Choose a ZIP file.' }); if (!(req.files?.previews || []).length) { fs.unlink(f.path, () => {}); return res.status(400).json({ error: 'Add at least one pattern-piece preview image so the customer can view the finished work in Workspace.' }); } const signature = Buffer.alloc(4); const handle = await fs.promises.open(f.path, 'r'); try { await handle.read(signature, 0, 4, 0); } finally { await handle.close(); } if (f.size < 22 || signature[0] !== 0x50 || signature[1] !== 0x4b) { fs.unlink(f.path, () => {}); return res.status(400).json({ error: 'The uploaded file is not a valid ZIP archive.' }); } const r = await PatternRequest.findById(req.params.id); if (!r) { fs.unlink(f.path, () => {}); return res.sendStatus(404); } if (r.resultZip && fs.existsSync(r.resultZip)) fs.unlink(r.resultZip, () => {}); r.resultZip = f.path; r.resultZipName = f.originalname; r.previewImages = (req.files?.previews || []).map(p => ({ path: p.path, name: p.originalname })); r.status = 'completed'; r.completedAt = new Date(); r.adminNote = String(req.body.adminNote || r.adminNote || '').slice(0, 2000); await r.save(); res.json({ request: safe(r) }); } catch (e) { next(e); } });
module.exports = router;
