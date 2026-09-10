const multer = require("multer");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { nanoid } = require("nanoid");

// Separate temp dir from garment-tool-uploads — different tool, same
// "transient input to a one-shot conversion, never served or persisted" idea.
const TMP_DIR = path.join(os.tmpdir(), "pose-tool-uploads");
fs.mkdirSync(TMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, `${nanoid(12)}${path.extname(file.originalname)}`),
});

// Photos only — no PSD here, this reads a real photo of a pose (runway,
// lookbook, reference shot), not a layered design file.
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXT.has(ext)) return cb(null, true);
  cb(new Error("Please upload a .png, .jpg, .jpeg, or .webp photo."));
}

const poseUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});

module.exports = { poseUpload, TMP_DIR };
