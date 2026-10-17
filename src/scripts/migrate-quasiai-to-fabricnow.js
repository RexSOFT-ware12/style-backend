/**
 * One-time Shopfront data migration: QuasiAI -> FabricNow.
 *
 * SAFE BY DEFAULT:
 *   npm run migrate-quasiai-to-fabricnow
 *     = read-only dry run
 *
 * APPLY:
 *   npm run migrate-quasiai-to-fabricnow -- --apply
 *
 * REPLACE THE KNOWN FABRICNOW DUMMY PRODUCTS:
 *   npm run migrate-quasiai-to-fabricnow -- --apply --replace-dummy-products
 *
 * IMPORTANT:
 *   This script intentionally migrates ONLY the Shopfront collections:
 *     - products
 *     - taxonomies
 *
 * It does NOT copy arbitrary QuasiAI collections such as users, profiles,
 * securitylogs, payments, qwesis, messages, healthcheckins, etc.
 *
 * The Workspace `fabrics` collection is intentionally NOT treated as
 * Shopfront `taxonomies`.
 *
 * Environment:
 *   MONGODB_URI              target/primary connection URI (FabricNow)
 *   MONGODB_DB_NAME          optional target DB name (default FabricNow)
 *   SOURCE_MONGODB_URI       optional source URI; defaults to MONGODB_URI
 *   SOURCE_MONGODB_DB_NAME   optional source DB name (default QuasiAI)
 *
 * The migration preserves MongoDB _id values.
 * It never drops a collection and never deletes source records.
 */

require("dotenv").config();

const { MongoClient } = require("mongodb");

const TARGET_DB_NAME = process.env.MONGODB_DB_NAME || "FabricNow";
const SOURCE_DB_NAME = process.env.SOURCE_MONGODB_DB_NAME || "QuasiAI";
const TARGET_URI = process.env.MONGODB_URI;
const SOURCE_URI = process.env.SOURCE_MONGODB_URI || TARGET_URI;
const APPLY = process.argv.includes("--apply");
const REPLACE_DUMMY = process.argv.includes("--replace-dummy-products");

// Deliberately explicit. Do not turn this into "all source collections".
const SHOPFRONT_COLLECTIONS = ["products", "taxonomies"];

const DUMMY_PRODUCT_SKUS = new Set([
  "FN-SNK-001", "FN-SNK-002", "FN-SNK-003", "FN-SNK-004", "FN-SNK-005",
  "FN-SNK-006", "FN-SNK-007", "FN-SNK-008", "FN-SNK-009", "FN-SNK-010",
]);

function assertConfig() {
  if (!TARGET_URI) {
    throw new Error("MONGODB_URI is required for the FabricNow target database.");
  }
  if (!SOURCE_URI) {
    throw new Error("SOURCE_MONGODB_URI is required when a separate source URI is needed.");
  }
}

async function migrateCollection(sourceDb, targetDb, name) {
  const source = sourceDb.collection(name);
  const target = targetDb.collection(name);
  const sourceCount = await source.countDocuments();
  const targetCount = await target.countDocuments();

  let inserted = 0;
  let skipped = 0;
  let conflicts = 0;
  const operations = [];

  if (!sourceCount) {
    return { name, sourceCount, targetCount, inserted, skipped, conflicts };
  }

  for await (const doc of source.find({})) {
    if (doc._id == null) {
      conflicts += 1;
      console.log(`  SKIP ${name} document without _id`);
      continue;
    }

    const existing = await target.findOne(
      { _id: doc._id },
      { projection: { _id: 1 } }
    );

    if (existing) {
      skipped += 1;
      continue;
    }

    operations.push({ insertOne: { document: doc } });
    inserted += 1;

    if (operations.length >= 500) {
      if (APPLY) {
        await target.bulkWrite(operations, { ordered: false });
      }
      operations.length = 0;
    }
  }

  if (APPLY && operations.length) {
    await target.bulkWrite(operations, { ordered: false });
  }

  return { name, sourceCount, targetCount, inserted, skipped, conflicts };
}

async function migrateProducts(sourceDb, targetDb) {
  const source = sourceDb.collection("products");
  const target = targetDb.collection("products");

  const sourceProducts = await source.find({}).toArray();
  const targetProducts = await target.find({}).toArray();

  const sourceReal = sourceProducts.filter((p) => !DUMMY_PRODUCT_SKUS.has(p.sku));
  const targetDummy = targetProducts.filter((p) => DUMMY_PRODUCT_SKUS.has(p.sku));

  console.log("\nProducts:");
  console.log(`  QuasiAI total: ${sourceProducts.length}`);
  console.log(`  QuasiAI real/non-dummy: ${sourceReal.length}`);
  console.log(`  FabricNow total: ${targetProducts.length}`);
  console.log(`  FabricNow known dummy products: ${targetDummy.length}`);

  if (!sourceReal.length) {
    console.log("  No non-dummy source products found; no product migration performed.");
    return { inserted: 0, skipped: 0, conflicts: 0, dummyDeleted: 0 };
  }

  const sourceIds = new Set(sourceReal.map((p) => String(p._id)));
  const bySku = new Map(
    targetProducts.filter((p) => p.sku).map((p) => [p.sku, p])
  );

  let inserted = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const doc of sourceReal) {
    const existingById = await target.findOne(
      { _id: doc._id },
      { projection: { _id: 1 } }
    );
    const existingBySku = doc.sku ? bySku.get(doc.sku) : null;

    if (existingById || existingBySku) {
      skipped += 1;

      if (
        existingBySku &&
        String(existingBySku._id) !== String(doc._id)
      ) {
        conflicts += 1;
        console.log(
          `  SKU conflict: ${doc.sku} already exists in FabricNow with _id=${existingBySku._id}`
        );
      }

      continue;
    }

    if (APPLY) {
      await target.insertOne(doc);
    }

    inserted += 1;
    console.log(
      `  ${APPLY ? "INSERT" : "WOULD INSERT"} product ${doc.sku || doc._id}`
    );
  }

  let dummyDeleted = 0;

  if (REPLACE_DUMMY && targetDummy.length) {
    console.log(
      `\nDummy product replacement requested: ${targetDummy.length} target product(s).`
    );

    for (const dummy of targetDummy) {
      if (sourceIds.has(String(dummy._id))) {
        console.log(
          `  Not deleting dummy ${dummy.sku}: _id also exists in source.`
        );
        continue;
      }

      if (APPLY) {
        await target.deleteOne({ _id: dummy._id });
      }

      dummyDeleted += 1;
      console.log(
        `  ${APPLY ? "DELETE" : "WOULD DELETE"} dummy ${dummy.sku}`
      );
    }
  } else if (targetDummy.length) {
    console.log(
      "  Dummy products preserved. Use --replace-dummy-products with --apply to remove them."
    );
  }

  return { inserted, skipped, conflicts, dummyDeleted };
}

async function main() {
  assertConfig();

  console.log("=== QuasiAI -> FabricNow SHOPFRONT migration ===");
  console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY RUN (read only)"}`);
  console.log(`Source database: ${SOURCE_DB_NAME}`);
  console.log(`Target database: ${TARGET_DB_NAME}`);
  console.log(`Allowed collections: ${SHOPFRONT_COLLECTIONS.join(", ")}`);
  console.log(`Replace known dummy products: ${REPLACE_DUMMY ? "YES" : "NO"}`);
  console.log("");

  const sourceClient = new MongoClient(SOURCE_URI);
  const targetClient = new MongoClient(TARGET_URI);

  await sourceClient.connect();
  await targetClient.connect();

  try {
    const sourceDb = sourceClient.db(SOURCE_DB_NAME);
    const targetDb = targetClient.db(TARGET_DB_NAME);

    // We intentionally inspect ONLY the allowed collections.
    console.log("Shopfront collection counts:");

    for (const name of SHOPFRONT_COLLECTIONS) {
      const sourceCount = await sourceDb.collection(name).countDocuments();
      const targetCount = await targetDb.collection(name).countDocuments();

      console.log(
        `  ${name}: QuasiAI=${sourceCount}, FabricNow=${targetCount}`
      );
    }

    const productResult = await migrateProducts(sourceDb, targetDb);

    // Taxonomies are merged by _id.
    const taxonomyResult = await migrateCollection(
      sourceDb,
      targetDb,
      "taxonomies"
    );

    console.log("\nTaxonomies:");
    console.log(`  QuasiAI total: ${taxonomyResult.sourceCount}`);
    console.log(`  FabricNow before: ${taxonomyResult.targetCount}`);
    console.log(
      `  ${APPLY ? "Inserted" : "Would insert"}: ${taxonomyResult.inserted}`
    );
    console.log(`  Already present/skipped: ${taxonomyResult.skipped}`);
    console.log(`  Conflicts: ${taxonomyResult.conflicts}`);

    console.log("\n=== Migration summary ===");
    console.log(`Allowed collections: ${SHOPFRONT_COLLECTIONS.join(", ")}`);
    console.log(`Products inserted/would insert: ${productResult.inserted}`);
    console.log(`Products skipped: ${productResult.skipped}`);
    console.log(`Product conflicts: ${productResult.conflicts}`);
    console.log(
      `Dummy products deleted/would delete: ${productResult.dummyDeleted}`
    );
    console.log(
      `Taxonomies inserted/would insert: ${taxonomyResult.inserted}`
    );
    console.log(`Taxonomies skipped: ${taxonomyResult.skipped}`);
    console.log(`Taxonomy conflicts: ${taxonomyResult.conflicts}`);

    if (!APPLY) {
      console.log("\nDRY RUN ONLY: no documents were changed.");
      console.log(
        "Review the output, then run with --apply to perform ONLY this Shopfront migration."
      );
    } else {
      console.log(
        "\nMigration writes completed. QuasiAI source data was not modified."
      );
      console.log(
        "Only products and taxonomies were touched in FabricNow."
      );
    }
  } finally {
    await Promise.allSettled([
      sourceClient.close(),
      targetClient.close(),
    ]);
  }
}

main().catch((err) => {
  console.error(
    "\nMigration failed:",
    err && err.stack ? err.stack : err
  );
  process.exit(1);
});
