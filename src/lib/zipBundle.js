// Builds the auto-generated Design Pattern download bundle: a .zip
// containing the admin's original uploaded raster (PNG/JPG) plus the SVG
// traced from it. This is what lets the admin skip uploading a separate
// .zip by hand — the deliverable customers download is assembled here.
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");
const { nanoid } = require("nanoid");

/**
 * @param {object} opts
 * @param {string} opts.rasterPath - path to the original uploaded image on disk
 * @param {string} opts.rasterName - filename to give the raster inside the zip
 * @param {string} opts.svgPath - path to the traced SVG on disk
 * @param {string} opts.svgName - filename to give the SVG inside the zip
 * @param {string} destDir - directory the resulting .zip is written into
 * @returns {Promise<{filename: string, filePath: string, size: number}>}
 */
async function buildImageBundleZip({ rasterPath, rasterName, svgPath, svgName }, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const filename = `${nanoid(14)}.zip`;
  const filePath = path.join(destDir, filename);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    archive.file(rasterPath, { name: rasterName });
    archive.file(svgPath, { name: svgName });

    archive.finalize();
  });

  const stats = fs.statSync(filePath);
  return { filename, filePath, size: stats.size };
}

module.exports = { buildImageBundleZip };
