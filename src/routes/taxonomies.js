const express = require("express");
const Taxonomy = require("../models/Taxonomy");
const Product = require("../models/Product");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const TYPES = new Set(["category", "style", "fabric"]);

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateType(type) {
  return TYPES.has(String(type || "").toLowerCase());
}

// GET /api/taxonomies — public; used by the storefront and dashboard forms.
router.get("/", async (req, res, next) => {
  try {
    const docs = await Taxonomy.find({ active: true }).sort({ type: 1, sortOrder: 1, name: 1 });
    const result = { categories: [], styles: [], fabrics: [] };
    for (const doc of docs) {
      if (doc.type === "category") result.categories.push(doc.name);
      if (doc.type === "style") result.styles.push(doc.name);
      if (doc.type === "fabric") result.fabrics.push(doc.name);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/taxonomies/manage — dashboard list including inactive values.
router.get("/manage", requireAuth, async (req, res, next) => {
  try {
    const docs = await Taxonomy.find().sort({ type: 1, sortOrder: 1, name: 1 });
    res.json({ data: docs.map((d) => d.toJSON()) });
  } catch (err) {
    next(err);
  }
});

// POST /api/taxonomies — dashboard add.
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const type = String(req.body?.type || "").toLowerCase();
    const name = String(req.body?.name || "").trim();
    const sortOrder = Number(req.body?.sortOrder) || 0;
    if (!validateType(type)) return res.status(400).json({ error: "type must be category, style, or fabric" });
    if (!name || name.length > 80) return res.status(400).json({ error: "name is required and must be 80 characters or fewer" });

    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: "Please enter a valid name" });

    const existing = await Taxonomy.findOne({ type, slug });
    if (existing) return res.status(409).json({ error: "That value already exists" });

    const doc = await Taxonomy.create({ type, name, slug, sortOrder, active: true });
    res.status(201).json({ data: doc.toJSON() });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: "That value already exists" });
    next(err);
  }
});

// PUT /api/taxonomies/:id — rename/reorder/activate.
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const doc = await Taxonomy.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Value not found" });

    const nextName = req.body?.name !== undefined ? String(req.body.name).trim() : doc.name;
    const nextSlug = slugify(nextName);
    if (!nextName || !nextSlug) return res.status(400).json({ error: "name is required" });

    const oldName = doc.name;
    doc.name = nextName;
    doc.slug = nextSlug;
    if (req.body?.sortOrder !== undefined) doc.sortOrder = Number(req.body.sortOrder) || 0;
    if (req.body?.active !== undefined) doc.active = Boolean(req.body.active);
    await doc.save();

    // Keep existing products consistent when a taxonomy label is renamed.
    if (oldName !== nextName) {
      const field = doc.type;
      await Product.updateMany({ [field]: oldName }, { $set: { [field]: nextName } });
    }

    res.json({ data: doc.toJSON() });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: "That value already exists" });
    next(err);
  }
});

// DELETE /api/taxonomies/:id — soft delete so historical products keep their value.
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const doc = await Taxonomy.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Value not found" });
    doc.active = false;
    await doc.save();
    res.json({ data: doc.toJSON() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
