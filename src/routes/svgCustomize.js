// POST /api/svg-customize/process (auth + premium required)
//
// The paid sibling of the free public tracer at
// POST /api/products/design-patterns/preview. That endpoint always uses
// fixed defaults (steps=5, threshold=200, black fill, transparent bg) so
// anonymous visitors get one consistent "try it live" result. This one lets
// a signed-in, entitled user tune the trace — posterize steps, threshold,
// fill color, background, speckle removal, curve tolerance — which is the
// "SVG customization" feature gated behind the 3-day trial / premium plan.
const express = require("express");
const fs = require("fs");
const os = require("os");

const { requireAuth } = require("../middleware/auth");
const { requirePremium } = require("../middleware/requirePremium");
const { svgPreviewUpload } = require("../middleware/svgPreviewUpload");
const { convertPngToSvg } = require("../lib/svgConvert");

const router = express.Router();

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

router.post(
  "/process",
  requireAuth,
  requirePremium,
  svgPreviewUpload.single("image"),
  async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded. Field name must be "image".' });
    }

    const uploadPath = req.file.path;
    let tracedPath = null;
    const cleanup = () => {
      fs.unlink(uploadPath, () => {});
      if (tracedPath) fs.unlink(tracedPath, () => {});
    };

    try {
      const body = req.body || {};

      const color = typeof body.color === "string" && HEX_COLOR_RE.test(body.color) ? body.color : "#000000";
      const background =
        body.background === "transparent" || (typeof body.background === "string" && HEX_COLOR_RE.test(body.background))
          ? body.background
          : "transparent";

      const opts = {
        steps: clampInt(body.steps, 1, 32, 5),
        threshold: clampInt(body.threshold, 0, 255, 200),
        turdSize: clampInt(body.turdSize, 0, 100, 2),
        optTolerance: (() => {
          const n = Number.parseFloat(body.optTolerance);
          return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.3;
        })(),
        color,
        background,
      };

      const { svg, filePath } = await convertPngToSvg(uploadPath, os.tmpdir(), opts);
      tracedPath = filePath;
      res.json({ svg, options: opts });
    } catch (err) {
      next(err);
    } finally {
      cleanup();
    }
  }
);

module.exports = router;
