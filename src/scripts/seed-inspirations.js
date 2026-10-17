/**
 * Seeds the platform-wide InspirationLibrary (visible to ALL companies).
 *
 *   node src/scripts/seed-inspirations.js [--dry]
 *
 * Idempotent: upserts on seedId. Items removed from the JSON are deactivated
 * (active:false), not deleted. No company or user id needed.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, mongoose } = require("../db");
const InspirationLibrary = require("../models/InspirationLibrary");

const FILE = path.resolve(__dirname, "../data/african-fashion-inspiration.json");

(async () => {
  const { items } = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (process.argv.includes("--dry")) { console.log(`Dry run: would upsert ${items.length} items.`); return; }
  await connectDB();
  const ops = items.map((it) => ({
    updateOne: {
      filter: { seedId: it.id },
      update: { $set: {
        type: it.type, gender: it.gender, category: it.category, style: it.style, region: it.region,
        title: it.title, sourceAccount: it.source_account || "", url: it.url,
        searchQuery: it.search_query || "", tags: it.tags, origin: it.origin, active: true,
      } },
      upsert: true,
    },
  }));
  await InspirationLibrary.bulkWrite(ops);
  const res = await InspirationLibrary.updateMany({ seedId: { $nin: items.map((i) => i.id) } }, { $set: { active: false } });
  console.log(`Upserted ${items.length}; deactivated ${res.modifiedCount} stale.`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.connection.close());
