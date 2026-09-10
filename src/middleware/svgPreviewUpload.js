const multer = require("multer");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { nanoid } = require("nanoid");

// Temp storage for the public "try it live" PNG -> SVG preview tool on the
// storefront's Design Patterns page. Separate from every other upload dir —
// these files are a one-shot conversion input, never served or persisted,
// and the route handler unlinks them itself right after tracing.
const TMP_DIR = path.join(os.tmpdir(), "svg-preview-uploads");
fs.mkdirSync(TMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, `${nanoid(12)}${path.extname(file.originalname) || ".png"}`),
});

const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXT.has(ext)) return cb(null, true);
  cb(new Error("Please upload a .png, .jpg, .jpeg, or .webp image."));
}

// This is an unauthenticated, public-facing tool (it's a shopfront demo, not
// the admin dashboard's product-creation upload), so the size cap is much
// tighter than the admin uploaders in middleware/upload.js.
const svgPreviewUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});

module.exports = { svgPreviewUpload, TMP_DIR };
