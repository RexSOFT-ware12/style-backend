const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { uploadToBucket } = require("../lib/gcs");

// Every product photo — no matter what the seller uploads (a tiny phone
// screenshot, a huge DSLR photo, portrait, landscape, PNG, WEBP...) — gets
// normalized to a square canvas so the storefront grid, cards, and product
// page all line up instead of showing a mix of stretched, inconsistently
// cropped, or low-res images.
//
// The hero "on model" shot(s) (fieldname "image") are meant to fill that
// square edge-to-edge, so those crop — the photographer framed them for it.
// The extra gallery ("Model") shots must show the entire photo with nothing
// cut off — cropping those was cutting heads/edges off — so they're scaled
// to fit *inside* the square instead, padded with a transparent border
// rather than losing any of the image.
const PRODUCT_IMAGE_SIZE = 1600; // px, square — sharp enough for retina/zoom views
const JPEG_QUALITY = 90; // high quality, still web-friendly file size
const PNG_QUALITY = 90;

// Fields whose photos must never be cropped — the whole subject (a full
// alternate-model shot) always has to stay visible.
const NO_CROP_FIELDS = new Set(["images"]);

// The fabric close-up is *usually* a texture swatch (fine to crop to fill
// its frame), but sellers sometimes upload a full garment/body shot under
// this field instead. We can't tell which at upload time, so we must not
// destroy pixels here: resize down (capped at PRODUCT_IMAGE_SIZE on the
// long edge) while keeping the original aspect ratio, with NO crop and NO
// padding. The storefront gallery then decides how to *display* it —
// object-cover to fill the frame by default, object-contain on hover/press
// to reveal anything the cover-fill would otherwise hide. That only works
// if the full photo still exists in the file; cropping it here (like the
// old "cover" pipeline did) throws the data away permanently and no amount
// of frontend logic can bring it back.
const NO_PAD_FIT_INSIDE_FIELDS = new Set(["fabricImage"]);

/**
 * Resize + re-encode a single uploaded file in place (on disk).
 * Mutates the multer `file` object's filename/path/mimetype/size so the
 * route handler downstream (which reads file.filename) picks up the
 * processed image automatically.
 */
async function normalizeImageFile(file) {
  if (!file) return;

  const noCrop = NO_CROP_FIELDS.has(file.fieldname);
  const fitInsideNoPad = NO_PAD_FIT_INSIDE_FIELDS.has(file.fieldname);
  const outputExt = noCrop ? "png" : "jpg";

  const dir = path.dirname(file.path);
  const base = path.basename(file.filename, path.extname(file.filename));
  const outputFilename = `${base}.${outputExt}`;
  const outputPath = path.join(dir, outputFilename);
  const tempPath = path.join(dir, `${base}.tmp.${outputExt}`);

  let pipeline = sharp(file.path).rotate(); // respect the camera's EXIF orientation first

  if (noCrop) {
    // Scale the whole image down to fit inside the square — never crops —
    // and pad any leftover space with a fully transparent border.
    pipeline = pipeline
      .resize(PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ quality: PNG_QUALITY, compressionLevel: 9 });
  } else if (fitInsideNoPad) {
    // Cap the long edge at PRODUCT_IMAGE_SIZE, keep the original aspect
    // ratio, never upscale — no crop, no padding. Output stays whatever
    // rectangle the photo actually is; the frontend crops/reveals it live.
    pipeline = pipeline
      .resize(PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  } else {
    pipeline = pipeline
      .resize(PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE, {
        fit: "cover", // fills the whole square, cropping instead of squashing
        position: "centre",
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  }

  await pipeline.toFile(tempPath);

  // Swap the processed file in and drop the raw upload (whatever size/format
  // it originally was) — we never need it again once the normalized
  // version exists.
  fs.unlinkSync(file.path);
  fs.renameSync(tempPath, outputPath);

  const stats = fs.statSync(outputPath);
  file.filename = outputFilename;
  file.path = outputPath;
  file.mimetype = noCrop ? "image/png" : "image/jpeg";
  file.size = stats.size;

  // If a storage bucket is configured, actually upload the normalized file
  // there and remember the real public URL on the file object — this is
  // what the route handler uses instead of guessing a bucket URL for a
  // file that was never actually sent to the bucket.
  try {
    const publicUrl = await uploadToBucket(outputPath, outputFilename);
    if (publicUrl) {
      file.publicUrl = publicUrl;
      // Local disk (especially on App Engine) is ephemeral — once the
      // bucket has it, drop the local copy.
      fs.unlink(outputPath, () => {});
    }
  } catch (err) {
    // Bucket upload failed (bad/missing credentials, bucket doesn't exist,
    // network issue, etc.) — keep serving the local copy via /uploads
    // rather than losing the image entirely.
    console.error("GCS upload failed, falling back to local file serving:", err.message);
  }
}

// Express middleware: normalizes every image file on this request —
// req.files.image[0] (hero/on-model shot), req.files.fabricImage[0]
// (fabric close-up), and each of req.files.images[] (gallery shots) —
// from productUpload. No-ops on fields that weren't sent this request
// (e.g. an edit that only replaces the digitalFile).
function processProductImage(req, res, next) {
  const jobs = [
    ...(req.files?.image || []),
    ...(req.files?.fabricImage || []),
    ...(req.files?.images || []),
  ];

  if (jobs.length === 0) return next();

  Promise.all(jobs.map((file) => normalizeImageFile(file)))
    .then(() => next())
    .catch((err) => {
      // Don't fail product creation/editing over an image-processing hiccup —
      // fall back to serving whichever files the seller actually sent.
      console.error("Product image processing failed, keeping original upload(s):", err.message);
      next();
    });
}

module.exports = { processProductImage, normalizeImageFile, PRODUCT_IMAGE_SIZE, JPEG_QUALITY };