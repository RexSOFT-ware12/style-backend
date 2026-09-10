/**
 * One-time migration: rewrite any product image/fabricImage/images URLs
 * that were saved as http://<host>/api/products/assets/... back before the
 * `app.set("trust proxy", true)` fix, so they become https://.
 *
 * Safe to run more than once — it only touches URLs starting with the
 * literal "http://" prefix on your own API host, and does nothing to any
 * product that's already correct (e.g. the /images/NoImage.jpg default, or
 * an externally hosted image URL you might have set by hand).
 *
 * Usage:
 *   node scripts/fix-image-protocol.js
 *
 * Reads MONGODB_URI from backend/.env, same as the app itself.
 */
require("dotenv").config();
const { connectDB, mongoose } = require("../src/db");
const Product = require("../src/models/Product");

// Adjust this if you serve the API from a different host/domain.
const BAD_PREFIX = "http://stream-sell.de.r.appspot.com/api/products/assets/";
const GOOD_PREFIX = "https://stream-sell.de.r.appspot.com/api/products/assets/";

function fix(url) {
  return typeof url === "string" && url.startsWith(BAD_PREFIX)
    ? GOOD_PREFIX + url.slice(BAD_PREFIX.length)
    : url;
}

async function main() {
  await connectDB();

  const products = await Product.find({
    $or: [
      { image: { $regex: `^${BAD_PREFIX}` } },
      { fabricImage: { $regex: `^${BAD_PREFIX}` } },
      { images: { $elemMatch: { $regex: `^${BAD_PREFIX}` } } },
    ],
  });

  console.log(`Found ${products.length} product(s) with http:// asset URLs.`);

  for (const product of products) {
    product.image = fix(product.image);
    product.fabricImage = fix(product.fabricImage);
    product.images = (product.images || []).map(fix);
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
