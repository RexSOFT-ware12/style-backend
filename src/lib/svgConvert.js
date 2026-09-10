// Deterministic PNG -> SVG conversion.
//
// This is plain bitmap-tracing (Peter Selinger's Potrace algorithm, via the
// `potrace` npm package) — no AI/model involved. Given the same input image
// and the same options, it always produces the exact same output SVG.
//
// How it works, in short:
//   1. `sharp` normalizes the upload (flattens transparency onto white,
//      caps the resolution) so tracing has a clean, consistent bitmap.
//   2. `potrace.posterize()` reduces the image to a handful of tone levels
//      and traces the outline of each level into a closed vector path.
//      More `steps` = more tone levels retained = closer to the original,
//      at the cost of a more complex (larger) SVG.
//
// This works best on flat-color / line-art / logo-like source images (which
// is what a "design pattern" swatch or icon usually is). It is not meant to
// losslessly vectorize a photograph — potrace has no notion of gradients,
// so photographic images come out posterized/blocky.
const potrace = require("potrace");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { nanoid } = require("nanoid");

const MAX_TRACE_DIMENSION = 1200; // px — plenty for a print/pattern preview, keeps trace fast

function posterizeToSvg(buffer, options) {
  return new Promise((resolve, reject) => {
    potrace.posterize(buffer, options, (err, svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
}

/**
 * Converts an uploaded raster image (PNG/JPEG/etc.) at `inputPath` into an
 * SVG file written into `outputDir`.
 *
 * @param {string} inputPath - path to the source raster image on disk
 * @param {string} outputDir - directory the resulting .svg is written into
 * @param {object} [opts]
 * @param {number} [opts.steps=5] - number of posterize tone levels (1-255).
 *   Higher = more faithful to the original / larger SVG.
 * @param {number} [opts.threshold=200] - 0-255 cutoff potrace uses internally.
 * @param {string} [opts.color="#000000"] - fill color applied to every
 *   traced shape (see note below on why a single literal color matters).
 * @param {string} [opts.background="transparent"] - SVG background color.
 * @param {number} [opts.turdSize=2] - ignore speckles smaller than this many px.
 * @param {number} [opts.optTolerance=0.3] - curve-fitting tolerance — smaller
 *   = more accurate, larger file.
 *   These last four are only ever passed by the premium SVG customization
 *   endpoint (routes/svgCustomize.js) — the free public tracer on
 *   /design-patterns always uses the defaults below.
 * @returns {Promise<{filename: string, filePath: string, svg: string}>}
 */
async function convertPngToSvg(inputPath, outputDir, opts = {}) {
  const steps = Number.isInteger(opts.steps) ? opts.steps : 5;
  const threshold = Number.isInteger(opts.threshold) ? opts.threshold : 200;
  const color = typeof opts.color === "string" ? opts.color : "#000000";
  const background = typeof opts.background === "string" ? opts.background : "transparent";
  const turdSize = Number.isInteger(opts.turdSize) ? opts.turdSize : 2;
  const optTolerance = typeof opts.optTolerance === "number" ? opts.optTolerance : 0.3;

  // Flatten any transparency onto white first — potrace works off luminance
  // and treats transparent pixels unpredictably otherwise — then cap the
  // resolution so tracing stays fast on huge uploads.
  const preprocessed = await sharp(inputPath)
    .flatten({ background: "#ffffff" })
    .resize(MAX_TRACE_DIMENSION, MAX_TRACE_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  const svg = await posterizeToSvg(preprocessed, {
    steps,
    threshold,
    // A fixed hex color (rather than "auto") — every traced shape gets this
    // exact literal fill value, with tone/shading preserved entirely via
    // each shape's fill-opacity. That's what makes these patterns cleanly
    // recolorable on the storefront: swapping this one fill string (see
    // isSvgSrc / the color-swatch picker in ProductGallery.tsx) retints the
    // whole pattern, tones and all, without touching any path data.
    color,
    background,
    fill: "spread", // even tone spacing across the posterize range
    turdSize,
    optTolerance,
  });

  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `${nanoid(12)}.svg`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, svg, "utf8");

  return { filename, filePath, svg };
}

module.exports = { convertPngToSvg };
