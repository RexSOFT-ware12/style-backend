/**
 * One-time migration: rewrite product image URLs stored with the former API
 * hostname so they use PUBLIC_API_URL (or the current FabricNow API hostname).
 *
 * Safe to run more than once — it only touches URLs starting with the
 * legacy API hostname, and does nothing to local paths or externally hosted
 * images.
 *
 * Usage:
 *   node scripts/fix-image-protocol.js
 *
 * Reads MONGODB_URI from backend/.env, same as the app itself.
 */
require("dotenv").config();
const { connectDB, mongoose } = require("../src/db");
const Product = require("../src/models/Product");
const { LEGACY_API_HOST, normalizeProductImageUrl } = require("../src/lib/productImageUrls");

const LEGACY_URL_REGEX = new RegExp(
  `^https?:\\/\\/${LEGACY_API_HOST.replace(/\./g, "\\.")}(?::\\d+)?(?:\\/|$)`,
  "i"
);

async function main() {
  await connectDB();

  const products = await Product.find({
    $or: [
      { image: { $regex: LEGACY_URL_REGEX } },
      { heroImages: { $elemMatch: { $regex: LEGACY_URL_REGEX } } },
      { fabricImage: { $regex: LEGACY_URL_REGEX } },
      { images: { $elemMatch: { $regex: LEGACY_URL_REGEX } } },
    ],
  });

  console.log(`Found ${products.length} product(s) with legacy API image URLs.`);

  for (const product of products) {
    product.image = normalizeProductImageUrl(product.image);
    product.heroImages = (product.heroImages || []).map(normalizeProductImageUrl);
    product.fabricImage = normalizeProductImageUrl(product.fabricImage);
    product.images = (product.images || []).map(normalizeProductImageUrl);
    await product.save();
    console.log(`Fixed: ${product.name} (${product._id})`);
  }

  console.log("Done.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
