const Taxonomy = require("../models/Taxonomy");

require("dotenv").config();

// These are the values that were previously hardcoded in the dashboard.
// They are only starter data: admins can add, rename, deactivate, and reorder
// values from the dashboard without changing code.
const STARTER_VALUES = {
  category: [
    "Dresses",
    "Tops & Blouses",
    "Jackets & Outerwear",
    "Skirts",
    "Pants & Trousers",
    "Jumpsuits & Rompers",
    "Knitwear",
    "Activewear",
    "Bridal & Formal",
    "Fabric Packs",
  ],
  style: [
    "Fitted",
    "Oversized",
    "Draped",
    "Tailored",
    "Flowy",
    "Structured",
    "Layered",
    "Streetwear",
    "Minimalist",
    "Avant-Garde",
  ],
  fabric: [
    "Cotton",
    "Linen",
    "Silk",
    "Satin",
    "Chiffon",
    "Velvet",
    "Denim",
    "Leather",
    "Suede",
    "Wool",
    "Cashmere",
    "Lace",
    "Mesh",
    "Knit/Jersey",
    "Polyester",
    "Canvas",
    "Tweed",
    "Fleece",
    "Sequin",
  ],
};

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function seedTaxonomies() {
  let created = 0;
  for (const [type, names] of Object.entries(STARTER_VALUES)) {
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const slug = slugify(name);
      const result = await Taxonomy.updateOne(
        { type, slug },
        { $setOnInsert: { type, name, slug, active: true, sortOrder: index } },
        { upsert: true }
      );
      if (result.upsertedCount) created += 1;
    }
  }
  console.log(`Taxonomy seed complete: ${created} starter values added.`);
}

async function main() {
  const mongoose = require("mongoose");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    await seedTaxonomies();
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { seedTaxonomies, STARTER_VALUES };
