/**
 * One-time migration of legacy JSON products into MongoDB.
 *
 * Source:
 *   src/data/db.json -> products[]
 *
 * Destination:
 *   MongoDB -> Product collection
 *
 * Safety:
 *   - Inserts only products whose SKU does not already exist in MongoDB.
 *   - Does not delete or update existing MongoDB products.
 *   - Safe to run more than once; subsequent runs skip already-imported SKUs.
 *   - The legacy `stock` field is intentionally not migrated because the
 *     current Product schema does not contain a stock field.
 *   - Legacy JSON `id` values are not copied into MongoDB `_id`; MongoDB
 *     creates the normal ObjectId for each imported product.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { connectDB, mongoose } = require("../db");
const Product = require("../models/Product");

const SOURCE_FILE = path.resolve(__dirname, "../data/db.json");

function toDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function mapProduct(product) {
  const now = new Date();

  return {
    name: String(product.name || "").trim(),
    sku: String(product.sku || "").trim(),
    price: Number(product.price) || 0,
    category: String(product.category || "Uncategorized").trim(),
    brand: String(product.brand || "FabricNow").trim(),
    style: String(product.style || "").trim(),
    fabric: String(product.fabric || "").trim(),
    color: String(product.color || "").trim(),
    size: String(product.size || "").trim(),
    description: String(product.description || ""),
    pinterestUrl: String(product.pinterestUrl || "").trim(),
    image: String(product.image || "/images/NoImage.jpg").trim(),
    heroImages: Array.isArray(product.heroImages) ? product.heroImages.filter(Boolean) : [],
    fabricImage: String(product.fabricImage || "").trim(),
    images: Array.isArray(product.images) ? product.images.filter(Boolean) : [],
    digitalFile: product.digitalFile || null,
    featured: Boolean(product.featured),
    reviews: Array.isArray(product.reviews) ? product.reviews : [],
    createdAt: toDate(product.createdAt, now),
    updatedAt: toDate(product.updatedAt, now),
  };
}

async function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`Legacy product file not found: ${SOURCE_FILE}`);
  }

  const source = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  const products = Array.isArray(source.products) ? source.products : [];

  if (products.length === 0) {
    console.log("No products found in src/data/db.json. Nothing to migrate.");
    return;
  }

  await connectDB();

  let inserted = 0;
  let skipped = 0;
  let invalid = 0;

  console.log(`Found ${products.length} legacy product(s).`);
  console.log(`MongoDB database: ${mongoose.connection.name}`);
  console.log("Starting product migration...\n");

  for (const legacyProduct of products) {
    const sku = String(legacyProduct.sku || "").trim();
    const name = String(legacyProduct.name || "").trim();

    if (!name || !sku) {
      invalid += 1;
      console.warn(
        `SKIP invalid product: ${name || "(missing name)"} — SKU is required for safe migration.`
      );
      continue;
    }

    const existing = await Product.findOne({ sku }).select("_id name sku").lean();

    if (existing) {
      skipped += 1;
      console.log(`SKIP existing SKU ${sku}: ${name}`);
      continue;
    }

    const document = mapProduct(legacyProduct);
    await Product.create(document);

    inserted += 1;
    console.log(`INSERT ${sku}: ${name}`);
  }

  console.log("\nProduct migration complete.");
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Invalid:  ${invalid}`);
  console.log(`  Source:   ${SOURCE_FILE}`);
  console.log("\nNote: legacy `stock` and legacy JSON `id` fields were intentionally not migrated.");
}

main()
  .catch((error) => {
    console.error("\nProduct migration failed:");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });
