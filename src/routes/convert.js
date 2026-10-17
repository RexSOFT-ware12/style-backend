// POST /api/convert/png-to-svg  (auth required, no plan gate)
//
// Workspace "Converter" page. Traces a raster image (PNG / JPG / WebP) into an SVG with
// Potrace, using the same deterministic tracer as the storefront (lib/svgConvert.js) but with
// the tuning options exposed. Everything else on the Converter page (SVG -> PNG, formats,
// PDF, units, colour, sizes) runs in the browser and never reaches the server.
const express = require("express");
const fs = require("fs");
const os = require("os");

const { requireAuth } = require("../middleware/auth");
const { svgPreviewUpload } = require("../middleware/svgPreviewUpload");
const { createRateLimiter } = require("../middleware/rateLimit");
const { convertPngToSvg } = require("../lib/svgConvert");
const { removeBackground } = require("../lib/bgRemove");

const router = express.Router();
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const limiter = createRateLimiter({ windowMs: 60_000, max: 30, message: "You are converting quickly. Please wait a minute and try again." });

const int = (v, min, max, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

router.post("/png-to-svg", requireAuth, limiter, svgPreviewUpload.single("image"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded. Field name must be "image".' });
  const uploadPath = req.file.path;
  let tracedPath = null;
  try {
    const b = req.body || {};
    const tol = Number.parseFloat(b.optTolerance);
    const opts = {
      steps: int(b.steps, 1, 32, 5),
      threshold: int(b.threshold, 0, 255, 200),
      turdSize: int(b.turdSize, 0, 100, 2),
      optTolerance: Number.isFinite(tol) ? Math.min(1, Math.max(0, tol)) : 0.3,
      color: HEX.test(b.color || "") ? b.color : "#000000",
      background: b.background === "transparent" || HEX.test(b.background || "") ? b.background : "transparent",
    };
    const { svg, filePath } = await convertPngToSvg(uploadPath, os.tmpdir(), opts);
    tracedPath = filePath;
    res.json({ svg, options: opts });
  } catch (err) {
    next(err);
  } finally {
    fs.unlink(uploadPath, () => {});
    if (tracedPath) fs.unlink(tracedPath, () => {});
  }
});

// POST /api/convert/remove-background  → image/png with a transparent background
const bgLimiter = createRateLimiter({ windowMs: 60_000, max: 12, message: "You are removing backgrounds quickly. Please wait a minute and try again." });
router.post("/remove-background", requireAuth, bgLimiter, svgPreviewUpload.single("image"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded. Field name must be "image".' });
  try {
    const png = await removeBackground(req.file.path, { edges: ["soft", "balanced", "crisp"].includes(req.body?.edges) ? req.body.edges : "balanced" });
    res.set({ "Content-Type": "image/png", "Cache-Control": "no-store" }).send(png);
  } catch (err) {
    if (err.status === 503) return res.status(503).set("Retry-After", "120").json({ error: err.message, code: err.code });
    next(err);
  } finally { fs.unlink(req.file.path, () => {}); }
});

module.exports = router;
