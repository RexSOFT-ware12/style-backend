/**
 * Seed the 15 FabricNow garment sticker products and build private download ZIPs.
 *
 * Run from style-backend:
 *   npm run seed-stickers
 *
 * Safe to re-run: products are upserted by their stable sticker SKU and their
 * generated private ZIP deliverables are refreshed. ZIPs are stored in the
 * system temporary directory while being uploaded, not in public static files.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const archiver = require("archiver");
const sharp = require("sharp");
const mongoose = require("mongoose");
const { connectDB } = require("../db");
const Product = require("../models/Product");
const { DIGITAL_DIR } = require("../middleware/upload");
const { uploadRawFile } = require("../lib/cloudinary");

const ROOT = path.resolve(__dirname, "../../seed-assets/stickers");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog.json"), "utf8"));

const PACK_CONTENTS = {
  "sticker-pack-starter": [
    "good-vibes", "voltage", "retro-sun", "flame-heart", "varsity-star", "night-shift",
  ],
  "sticker-pack-shorts": ["retro-sun", "wave", "checker", "cactus"],
  "sticker-pack-library": [
    "good-vibes", "voltage", "retro-sun", "flame-heart", "varsity-star", "night-shift",
    "cactus", "wave", "checker", "stay-wild", "cherries", "orbit",
  ],
};

async function makeZip(outputPath, files, readme) {
  // Preflight every source before archiver queues lazy file streams. This turns
  // missing artwork into a clear failure instead of a silently incomplete ZIP.
  for (const file of files) {
    try {
      const stat = await fs.promises.stat(file.path);
      if (!stat.isFile()) throw new Error("not a regular file");
    } catch (error) {
      throw new Error(`Cannot add ${file.name} to sticker ZIP; source is unavailable: ${file.path} (${error.message})`);
    }
  }

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath, { flags: "w" });
    const archive = archiver("zip", { zlib: { level: 9 } });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      reject(error);
    };
    output.once("close", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    output.once("error", fail);
    archive.once("error", fail);
    archive.on("warning", (error) => {
      // ENOENT warnings would otherwise produce a successful but incomplete ZIP.
      fail(error);
    });
    archive.pipe(output);
    archive.append(readme, { name: "README.txt" });
    for (const file of files) archive.file(file.path, { name: file.name });
    archive.finalize().catch(fail);
  });
}

async function buildDeliverable(item) {
  const slugs = item.isPack ? PACK_CONTENTS[item.id] : [item.slug];
  if (!slugs?.length) throw new Error(`No sticker contents configured for ${item.id}`);

  const files = [];
  const zipName = `${item.id}.zip`;
  const zipDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "fabricnow-stickers-"));
  const zipPath = path.join(zipDir, zipName);
  try {
    for (const slug of slugs) {
      const svgPath = path.join(ROOT, `${slug}.svg`);
      const pngPath = path.join(DIGITAL_DIR, `${item.id}-${slug}.png`);
      files.push({ path: svgPath, name: `SVG/${slug}.svg` });
      files.push({ path: pngPath, name: `PNG/${slug}.png` });
      try {
        const sourceStat = await fs.promises.stat(svgPath);
        if (!sourceStat.isFile()) throw new Error("not a regular file");
      } catch (error) {
        throw new Error(`Missing sticker artwork for ${item.id}: ${svgPath} (${error.message})`);
      }
      await sharp(svgPath, { density: 300 })
        .png()
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toFile(pngPath);
    }

    const readme = [
      `${item.name} — FabricNow digital sticker files`,
      "",
      "Your purchase includes scalable SVG artwork and transparent PNG exports.",
      "Use the SVG files for editing and print workflows; use PNG files for quick mockups.",
      "Artwork is supplied for personal use on your own garments and projects.",
      "",
      `Included designs: ${slugs.join(", ")}`,
      "",
    ].join("\n");
    await makeZip(zipPath, files, readme);
    // Cloudinary authenticated raw assets persist across App Engine/container
    // restarts and are only delivered through the paid-order download route.
    return await uploadRawFile(zipPath, zipName);
  } finally {
    await fs.promises.rm(zipDir, { recursive: true, force: true });
    await Promise.all(
      files.filter((file) => file.name.startsWith("PNG/"))
        .map((file) => fs.promises.unlink(file.path).catch(() => {}))
    );
  }
}

async function main() {
  await connectDB();
  fs.mkdirSync(DIGITAL_DIR, { recursive: true });
  let created = 0;
  let updated = 0;

  for (const item of CATALOG) {
    const digitalFile = await buildDeliverable(item);
    const values = {
      name: item.name,
      sku: item.id,
      price: item.price,
      category: "Garment Stickers",
      brand: "FabricNow",
      style: item.style,
      fabric: "",
      color: "",
      size: "",
      description: item.description,
      image: `/images/stickers/${item.slug}.svg`,
      heroImages: [`/images/stickers/${item.slug}.svg`],
      fabricImage: "",
      images: [],
      digitalFile,
      featured: Boolean(item.badge),
    };

    const existing = await Product.findOne({ sku: item.id }).select("_id").lean();
    await Product.findOneAndUpdate(
      { sku: item.id },
      { $set: values, $setOnInsert: { reviews: [] } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    if (existing) updated += 1;
    else created += 1;
    const sizeBytes = Number(digitalFile?.size);
    const sizeLabel = Number.isFinite(sizeBytes) && sizeBytes >= 0
      ? `${(sizeBytes / 1024).toFixed(1)} KB`
      : "size unavailable";
    console.log(`${existing ? "Updated" : "Created"} ${item.name} (${sizeLabel})`);
  }

  console.log(`Sticker seed complete: ${created} created, ${updated} updated.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Sticker seed failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
