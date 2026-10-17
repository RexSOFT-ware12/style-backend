/**
 * Read-only Shopfront MongoDB diagnostic.
 *
 * Purpose:
 *   Verify that the Shopfront backend is connected to the database that
 *   contains the real Shopfront Product and Taxonomy collections.
 *
 * This script NEVER inserts, updates, deletes, or migrates data.
 *
 * Run:
 *   node src/scripts/inspect-shopfront-db.js
 *
 * Uses:
 *   MONGODB_URI
 *   MONGODB_DB_NAME (optional; defaults to FabricNow, same as src/db.js)
 */
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set.");

  const dbName = process.env.MONGODB_DB_NAME || "FabricNow";

  await mongoose.connect(uri, { dbName });
  const db = mongoose.connection.db;

  console.log("\n=== Shopfront MongoDB diagnostic (READ ONLY) ===");
  console.log(`Database: ${mongoose.connection.name}`);
  console.log(`Host: ${mongoose.connection.host}`);

  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name).sort();

  console.log("\nCollections:");
  for (const name of names) console.log(`  - ${name}`);

  const productCollection = db.collection("products");
  const taxonomyCollection = db.collection("taxonomies");

  const [productCount, taxonomyCount] = await Promise.all([
    productCollection.countDocuments(),
    taxonomyCollection.countDocuments(),
  ]);

  console.log(`\nproducts:   ${productCount}`);
  console.log(`taxonomies: ${taxonomyCount}`);

  if (productCount > 0) {
    const products = await productCollection
      .find(
        {},
        {
          projection: {
            _id: 1,
            name: 1,
            sku: 1,
            category: 1,
            style: 1,
            fabric: 1,
            brand: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        }
      )
      .sort({ createdAt: 1 })
      .limit(20)
      .toArray();

    console.log("\nFirst products (max 20):");
    for (const p of products) {
      console.log(
        `  ${p._id} | sku=${p.sku || "-"} | category=${p.category || "-"} | ` +
        `style=${p.style || "-"} | fabric=${p.fabric || "-"} | name=${p.name || "-"}`
      );
    }
  }

  if (taxonomyCount > 0) {
    const taxonomies = await taxonomyCollection
      .find(
        {},
        {
          projection: {
            _id: 1,
            type: 1,
            name: 1,
            slug: 1,
            active: 1,
            sortOrder: 1,
          },
        }
      )
      .sort({ type: 1, sortOrder: 1, name: 1 })
      .limit(100)
      .toArray();

    console.log("\nTaxonomies (max 100):");
    for (const t of taxonomies) {
      console.log(
        `  ${t.type || "-"} | ${t.name || "-"} | active=${t.active !== false} | slug=${t.slug || "-"}`
      );
    }
  }

  console.log("\n=== End diagnostic ===\n");
}

main()
  .catch((err) => {
    console.error("\nShopfront DB diagnostic failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
