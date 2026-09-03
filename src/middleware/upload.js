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
  limits: { fileSize: 500 * 1024 * 1024 }, // up to 500MB — these bundles can be large
});

// Combined uploader for the "create/edit product" form: an optional preview
// image ("image") and an optional digital deliverable ("digitalFile").
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
  limits: { fileSize: 500 * 1024 * 1024 },
}).fields([
  { name: "image", maxCount: 1 },
  { name: "digitalFile", maxCount: 1 },
]);

module.exports = { upload, uploadDigital, productUpload, UPLOAD_DIR, DIGITAL_DIR };
