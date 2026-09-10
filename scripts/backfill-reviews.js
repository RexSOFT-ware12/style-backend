/**
 * One-off script: adds auto-generated (4.0–4.9 star) reviews to any
 * existing product that doesn't have any yet. New products already get
 * reviews at creation time (see src/routes/products.js) — this just
 * catches products that were created before that existed.
 *
 * Run with: node scripts/backfill-reviews.js
 */
require("dotenv").config();
const { connectDB, mongoose } = require("../src/db");
const Product = require("../src/models/Product");
const { generateReviews } = require("../src/lib/reviews");

async function run() {
  await connectDB();

  const products = await Product.find({
    $or: [{ reviews: { $exists: false } }, { reviews: { $size: 0 } }],
  });

  console.log(`Found ${products.length} product(s) with no reviews.`);

  for (const product of products) {
    product.reviews = generateReviews();
    await product.save();
    console.log(`  + added ${product.reviews.length} reviews to "${product.name}"`);
  }

  console.log("Done.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
