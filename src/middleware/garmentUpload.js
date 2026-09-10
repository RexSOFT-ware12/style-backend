const multer = require("multer");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { nanoid } = require("nanoid");

// Separate temp directory from the product-image uploads — these files are
// transient inputs to a one-shot conversion, never served or persisted.
const TMP_DIR = path.join(os.tmpdir(), "garment-tool-uploads");
fs.mkdirSync(TMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, `${nanoid(12)}${path.extname(file.originalname)}`),
});

const ALLOWED_EXT = new Set([".psd", ".png", ".jpg", ".jpeg", ".webp"]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXT.has(ext)) return cb(null, true);
  cb(new Error("Please upload a .psd, .png, .jpg, .jpeg, or .webp file."));
}

const garmentUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 }, // PSDs can be large
});

module.exports = { garmentUpload, TMP_DIR };
