// POST /api/garment-tool/process (dashboard only, requires auth)
//
// Upload a .psd or photo, get back a .zip download containing:
//   - avatar-dress-transparent.png  — background removed (always included)
//   - parts/*.svg + parts/*-mask.png — rough per-garment-part vector traces
//     (only if HF_TOKEN is configured; see lib/garmentTool.js)
//
// DEPLOYMENT NOTE: this app currently runs on App Engine standard (see
// app.yaml — instance_class F2, mostly read-only filesystem except /tmp).
// @imgly/background-removal-node downloads and runs an ONNX model at
// request time, which is heavier than anything else this backend does —
// test actual memory/cold-start behavior on F2 before relying on this in
// production. If it's too heavy here, the cleaner fix is running just this
// route as its own small Cloud Run service (writable disk, tunable memory)
// rather than trying to make App Engine standard fit.
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { requireAuth } = require("../middleware/auth");
const { requirePremium } = require("../middleware/requirePremium");
const { garmentUpload } = require("../middleware/garmentUpload");
const {
  extractRasterFromUpload,
  removeBackground,
  segmentGarmentParts,
  maskToSvg,
  buildGarmentZip,
} = require("../lib/garmentTool");

const router = express.Router();

router.post("/process", requireAuth, requirePremium, garmentUpload.single("file"), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Field name must be "file".' });
  }

  const cleanup = () => fs.unlink(req.file.path, () => {});

  try {
    const rasterBuffer = await extractRasterFromUpload(req.file.path, req.file.originalname);
    const transparentPngBuffer = await removeBackground(rasterBuffer);

    let parts = null;
    try {
      const segments = await segmentGarmentParts(transparentPngBuffer);
      if (segments) {
        parts = await Promise.all(
          segments.map(async (s) => {
            const { svg, cleaned } = await maskToSvg(s.mask);
            return { label: s.label, svg, maskPng: cleaned };
          })
        );
      }
    } catch (segErr) {
      // Segmentation is best-effort (free HF tier can rate-limit, or
      // HF_TOKEN may be missing/invalid) — never fail the whole request
      // over it, just return the background-removed image alone.
      console.error("Garment segmentation skipped:", segErr.message);
    }

    const zipDir = path.join(os.tmpdir(), "garment-tool-output");
    const zipPath = await buildGarmentZip({ transparentPngBuffer, parts }, zipDir);

    res.download(zipPath, "garment-processed.zip", (err) => {
      cleanup();
      fs.unlink(zipPath, () => {});
      if (err) next(err);
    });
  } catch (err) {
    cleanup();
    next(err);
  }
});

module.exports = router;
