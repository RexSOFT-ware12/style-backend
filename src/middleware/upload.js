const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { nanoid } = require("nanoid");

function resolveUploadDir() {
  const candidates = [
    path.resolve(process.cwd(), "uploads"),
    path.resolve(__dirname, "..", "..", "uploads"),
    path.resolve("/tmp", "fabricnow-uploads"),
  ];

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  throw new Error("Could not create a writable upload directory.");
}

const UPLOAD_DIR = resolveUploadDir();
const MAX_UPLOAD_SIZE = 1000 * 1024 * 1024;

// Digital product assets (the .zip bundles containing .zprj + pattern files)
// are stored separately from images, and are NEVER served statically —
// they're only ever handed out through the gated /api/orders download route.
const DIGITAL_DIR = path.join(UPLOAD_DIR, "digital");
fs.mkdirSync(DIGITAL_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${nanoid(12)}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (file.mimetype.startsWith("image/")) return cb(null, true);
  cb(new Error("Only image uploads are allowed"));
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

// Separate multer instance for the digital deliverable: a .zip bundle of
// the product's design files (e.g. a .zprj CLO3D project plus its assets).
const digitalStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DIGITAL_DIR),
  filename: (req, file, cb) => {
    cb(null, `${nanoid(14)}.zip`);
  },
});

function digitalFileFilter(req, file, cb) {
  const isZip =
    file.mimetype === "application/zip" ||
    file.mimetype === "application/x-zip-compressed" ||
    file.mimetype === "application/octet-stream" ||
    path.extname(file.originalname).toLowerCase() === ".zip";
  if (isZip) return cb(null, true);
  cb(new Error("Only .zip uploads are allowed for the digital product file"));
}

const uploadDigital = multer({
  storage: digitalStorage,
  fileFilter: digitalFileFilter,
  limits: { fileSize: MAX_UPLOAD_SIZE }, // up to 1000MB — these bundles can be large
});

// Combined uploader for the "create/edit product" form:
//  - "image"       — the primary hero shot(s) (fabric worn on an AI model),
//                    1 or more files — these auto-swipe on the storefront
//  - "fabricImage" — a close-up of the fabric itself, 1 file
//  - "images"      — extra on-model gallery shots (same garment, different
//                    angles/styles), up to 6 files
//  - "digitalFile" — the .zip deliverable, 1 file
// Each field needs its own filter/limits, so we route by fieldname.
const productUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, file.fieldname === "digitalFile" ? DIGITAL_DIR : UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      if (file.fieldname === "digitalFile") return cb(null, `${nanoid(14)}.zip`);
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${nanoid(12)}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "digitalFile") return digitalFileFilter(req, file, cb);
    return fileFilter(req, file, cb);
  },
  limits: { fileSize: MAX_UPLOAD_SIZE },
}).fields([
  { name: "image", maxCount: 6 },
  { name: "fabricImage", maxCount: 1 },
  { name: "images", maxCount: 6 },
  { name: "digitalFile", maxCount: 1 },
]);

// Uploader for the "Add Design Pattern" admin form:
//  - "image"       — the source PNG/raster artwork to trace into an SVG
//  - "digitalFile" — the .zip deliverable, same as regular products
const designPatternUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, file.fieldname === "digitalFile" ? DIGITAL_DIR : UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      if (file.fieldname === "digitalFile") return cb(null, `${nanoid(14)}.zip`);
      const ext = path.extname(file.originalname) || ".png";
      cb(null, `${nanoid(12)}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "digitalFile") return digitalFileFilter(req, file, cb);
    return fileFilter(req, file, cb);
  },
  limits: { fileSize: MAX_UPLOAD_SIZE },
}).fields([
  { name: "image", maxCount: 1 },
  { name: "digitalFile", maxCount: 1 },
]);

module.exports = {
  upload,
  uploadDigital,
  productUpload,
  designPatternUpload,
  UPLOAD_DIR,
  DIGITAL_DIR,
  MAX_UPLOAD_SIZE,
};
