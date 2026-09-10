// Backs the "Garment Tool" dashboard page: given an uploaded .psd or photo,
// produces a background-removed image plus (best-effort) rough vector
// tracings of individual garment parts.
//
// This is the automatable ~70% discussed with the admin, NOT a replacement
// for Photoshop:
//   - Background removal: fully automatic (@imgly/background-removal-node,
//     a real segmentation model, runs locally — no paid API).
//   - Part segmentation: OPTIONAL, only runs if HF_TOKEN is set. Uses the
//     free-tier Hugging Face Inference API against
//     mattmdjaga/segformer_b2_clothes. It gives coarse classes only
//     (Upper-clothes, Skirt, Dress, Pants, Belt, Scarf, Hat) — there is no
//     model anywhere that outputs "collar" or per-sleeve or the nested
//     bottom1..bottom6 fold layers this brand's PSDs use. Those remain a
//     manual/artistic decomposition step for a human in Photoshop (or any
//     vector editor) — see the SKIP_LABELS/labels note below.
//   - If HF_TOKEN isn't configured, or the segmentation call fails for any
//     reason, the tool still returns the background-removed image alone
//     rather than failing the whole request.
const sharp = require("sharp");
const potrace = require("potrace");
const archiver = require("archiver");
const { nanoid } = require("nanoid");
const fs = require("fs");
const path = require("path");
const { readPsd, initializeCanvas } = require("ag-psd");

// ag-psd needs an ImageData factory when decoding layer pixels in Node.
initializeCanvas(
  () => ({
    getContext: () => ({
      createImageData: (width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
    }),
  }),
  (width, height) => ({
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  })
);

const HF_MODEL = "mattmdjaga/segformer_b2_clothes";
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

// Body-part / non-garment classes we don't want traced into shapes.
const SKIP_LABELS = new Set([
  "Background",
  "Face",
  "Hair",
  "Left-leg",
  "Right-leg",
  "Left-shoe",
  "Right-shoe",
  "Left-hand",
  "Right-hand",
]);

function imageDataToPngBuffer(imageData) {
  return sharp(Buffer.from(imageData.data), {
    raw: { width: imageData.width, height: imageData.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

function findNamedLayer(layers, name) {
  for (const layer of layers || []) {
    if (layer.name && layer.name.trim().toLowerCase() === name && layer.imageData) {
      return layer;
    }
    if (layer.children) {
      const found = findNamedLayer(layer.children, name);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Returns a PNG buffer for whatever the admin uploaded.
 *  - Non-PSD files (png/jpg/webp) are read as-is; sharp/removeBackground
 *    downstream handle format conversion.
 *  - PSD files: looks for a top-level layer literally named "Layer 1"
 *    (matching this brand's convention of keeping the flattened avatar+dress
 *    composite on a layer with that name) and composites just that layer
 *    back onto a full-size transparent canvas. Falls back to the PSD's own
 *    flattened composite if no such layer exists.
 */
async function extractRasterFromUpload(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (ext !== ".psd") {
    return fs.promises.readFile(filePath);
  }

  const buffer = await fs.promises.readFile(filePath);
  // useImageData avoids needing the native `canvas` package — we get raw
  // pixel data back instead, which sharp can consume directly.
  const psd = readPsd(buffer, {
    skipLayerImageData: false,
    skipThumbnail: true,
    useImageData: true,
  });

  const layer1 = findNamedLayer(psd.children, "layer 1");

  if (layer1) {
    const layerPng = await imageDataToPngBuffer(layer1.imageData);
    return sharp({
      create: {
        width: psd.width,
        height: psd.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: layerPng, left: layer1.left || 0, top: layer1.top || 0 }])
      .png()
      .toBuffer();
  }

  if (psd.imageData) {
    return imageDataToPngBuffer(psd.imageData);
  }

  throw new Error('Could not find a layer named "Layer 1", and the PSD has no flattened composite to fall back to.');
}

let cachedRemoveBackground = null;
function getBackgroundRemover() {
  if (cachedRemoveBackground) return cachedRemoveBackground;
  try {
    ({ removeBackground: cachedRemoveBackground } = require("@imgly/background-removal-node"));
  } catch (err) {
    throw new Error(
      '@imgly/background-removal-node is not installed. Run "npm install @imgly/background-removal-node" in style-backend.'
    );
  }
  return cachedRemoveBackground;
}

/**
 * Removes the background, leaving only the subject on a transparent canvas.
 * Runs a real local segmentation model — first call downloads ~40-80MB of
 * ONNX weights (cached on disk after that). See the deployment note in
 * routes/garmentTool.js about running this on App Engine standard.
 */
async function removeBackground(pngBuffer) {
  const removeBg = getBackgroundRemover();
  // @imgly/background-removal-node infers the source format from
  // `blob.type`. If we hand it a raw Node Buffer, it silently wraps it in
  // `new Blob([buffer])` with no type set, which decodes to an empty MIME
  // type and throws "Unsupported format: ". Wrapping it ourselves with an
  // explicit type avoids that path entirely.
  const inputBlob = new Blob([pngBuffer], { type: "image/png" });
  const blob = await removeBg(inputBlob, {
    model: "small",
    output: { format: "image/png", quality: 1 },
  });
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Best-effort rough garment-part segmentation via Hugging Face's hosted
 * inference API. Returns null (feature disabled) if HF_TOKEN isn't set.
 * Throws on a genuine API error — callers should treat that as non-fatal
 * and continue without parts (see routes/garmentTool.js).
 */
async function segmentGarmentParts(pngBuffer) {
  if (!process.env.HF_TOKEN) return null;

  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      "Content-Type": "application/octet-stream",
    },
    body: pngBuffer,
  });

  if (!res.ok) {
    throw new Error(`Hugging Face segmentation request failed: ${res.status} ${await res.text()}`);
  }

  const segments = await res.json();
  return segments.filter((s) => !SKIP_LABELS.has(s.label));
}

/**
 * Traces one part's binary mask (base64 PNG from the HF response) into an
 * SVG path — the same potrace-based approach as lib/svgConvert.js, just
 * applied to a mask instead of a posterized photo.
 */
function maskToSvg(maskBase64) {
  return new Promise((resolve, reject) => {
    const maskBuffer = Buffer.from(maskBase64, "base64");
    sharp(maskBuffer)
      .greyscale()
      .threshold(128)
      .toBuffer()
      .then((cleaned) => {
        potrace.trace(cleaned, { threshold: 128, turdSize: 20, optTolerance: 0.3 }, (err, svg) => {
          if (err) reject(err);
          else resolve({ svg, cleaned });
        });
      })
      .catch(reject);
  });
}

/**
 * Bundles the background-removed PNG plus any traced part SVGs+masks into
 * a single .zip, the same way lib/zipBundle.js does for design patterns.
 */
async function buildGarmentZip({ transparentPngBuffer, parts }, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const filename = `${nanoid(14)}-garment.zip`;
  const filePath = path.join(destDir, filename);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    archive.append(transparentPngBuffer, { name: "avatar-dress-transparent.png" });

    if (parts && parts.length) {
      for (const part of parts) {
        const safeName = part.label.toLowerCase().replace(/\s+/g, "-");
        archive.append(part.svg, { name: `parts/${safeName}.svg` });
        archive.append(part.maskPng, { name: `parts/${safeName}-mask.png` });
      }
      archive.append(
        "These are rough auto-generated part outlines (top/bottom/belt/etc via a generic clothes-parsing model), " +
          "not the fine sleeve/collar/fold-layer split the design PSDs use — those still need manual refinement.\n",
        { name: "parts/README.txt" }
      );
    }

    archive.finalize();
  });

  return filePath;
}

module.exports = {
  extractRasterFromUpload,
  removeBackground,
  segmentGarmentParts,
  maskToSvg,
  buildGarmentZip,
};
