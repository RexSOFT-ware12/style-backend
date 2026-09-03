const express = require("express");
const { nanoid } = require("nanoid");
const { readDb, writeDb } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { upload } = require("../middleware/upload");

const router = express.Router();

function toPublicUrl(req, filename) {
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
}

function serialize(product) {
  return product;
}

// ---------------------------------------------------------------------------
// GET /api/products
// Supports: ?search=&category=&style=&fabric=&brand=&minPrice=&maxPrice=
//           &sort=price_asc|price_desc|newest|name_asc&page=&limit=
// This single endpoint powers the storefront's product grid AND the
// dashboard's inventory table — same data, same filters, no duplication.
// ---------------------------------------------------------------------------
router.get("/", (req, res) => {
  const db = readDb();
  let items = [...db.products];

  const {
    search,
    category,
    style,
    fabric,
    brand,
    minPrice,
    maxPrice,
    sort,
    page = 1,
    limit = 50,
  } = req.query;

  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q)
    );
  }
  if (category) items = items.filter((p) => p.category?.toLowerCase() === String(category).toLowerCase());
  if (style) items = items.filter((p) => p.style?.toLowerCase() === String(style).toLowerCase());
  if (fabric) items = items.filter((p) => p.fabric?.toLowerCase() === String(fabric).toLowerCase());
  if (brand) items = items.filter((p) => p.brand?.toLowerCase() === String(brand).toLowerCase());
  if (minPrice) items = items.filter((p) => p.price >= Number(minPrice));
  if (maxPrice) items = items.filter((p) => p.price <= Number(maxPrice));

  switch (sort) {
    case "price_asc":
      items.sort((a, b) => a.price - b.price);
      break;
    case "price_desc":
      items.sort((a, b) => b.price - a.price);
      break;
    case "name_asc":
      items.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "newest":
    default:
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const total = items.length;
  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Number(limit));
  const start = (pageNum - 1) * limitNum;
  const paged = items.slice(start, start + limitNum);

  res.json({
    data: paged.map(serialize),
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  });
});

// GET /api/products/meta — distinct filter values, used by both the
// storefront's filter bar and the dashboard's "Add Product" dropdowns.
router.get("/meta", (req, res) => {
  const db = readDb();
  const distinct = (key) =>
    [...new Set(db.products.map((p) => p[key]).filter(Boolean))].sort();

  res.json({
    categories: distinct("category"),
    styles: distinct("style"),
    fabrics: distinct("fabric"),
    brands: distinct("brand"),
  });
});

// GET /api/products/:id
router.get("/:id", (req, res) => {
  const db = readDb();
  const product = db.products.find((p) => String(p.id) === String(req.params.id));
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json({ data: serialize(product) });
});

// ---------------------------------------------------------------------------
// POST /api/products  (protected — dashboard only)
// Accepts multipart/form-data (image file) OR plain JSON (image URL string).
// ---------------------------------------------------------------------------
router.post("/", requireAuth, upload.single("image"), (req, res) => {
  const body = req.body || {};

  if (!body.name || body.price === undefined) {
    return res.status(400).json({ error: "name and price are required" });
  }

  const db = readDb();

  const image = req.file
    ? toPublicUrl(req, req.file.filename)
    : body.image || "/images/NoImage.jpg";

  const now = new Date().toISOString();
  const product = {
    id: nanoid(10),
    name: body.name,
    sku: body.sku || `FN-${nanoid(6).toUpperCase()}`,
    price: Number(body.price) || 0,
    stock: Number(body.stock) || 0,
    category: body.category || "Uncategorized",
    brand: body.brand || "FabricNow",
    style: body.style || "",
    fabric: body.fabric || "",
    color: body.color || "",
    size: body.size || "",
    description: body.description || "",
    image,
    images: [image],
    featured: body.featured === "true" || body.featured === true,
    createdAt: now,
    updatedAt: now,
  };

  db.products.unshift(product);
  writeDb(db);

  res.status(201).json({ data: product });
});

// PUT /api/products/:id (protected)
router.put("/:id", requireAuth, upload.single("image"), (req, res) => {
  const db = readDb();
  const idx = db.products.findIndex((p) => String(p.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Product not found" });

  const body = req.body || {};
  const existing = db.products[idx];

  const image = req.file ? toPublicUrl(req, req.file.filename) : body.image || existing.image;

  const updated = {
    ...existing,
    name: body.name ?? existing.name,
    sku: body.sku ?? existing.sku,
    price: body.price !== undefined ? Number(body.price) : existing.price,
    stock: body.stock !== undefined ? Number(body.stock) : existing.stock,
    category: body.category ?? existing.category,
    brand: body.brand ?? existing.brand,
    style: body.style ?? existing.style,
    fabric: body.fabric ?? existing.fabric,
    color: body.color ?? existing.color,
    size: body.size ?? existing.size,
    description: body.description ?? existing.description,
    image,
    images: image ? [image] : existing.images,
    featured: body.featured !== undefined ? body.featured === "true" || body.featured === true : existing.featured,
    updatedAt: new Date().toISOString(),
  };

  db.products[idx] = updated;
  writeDb(db);

  res.json({ data: updated });
});

// PATCH /api/products/:id/stock (protected) — quick stock adjustment
router.patch("/:id/stock", requireAuth, (req, res) => {
  const db = readDb();
  const idx = db.products.findIndex((p) => String(p.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Product not found" });

  const { stock, delta } = req.body || {};
  if (stock === undefined && delta === undefined) {
    return res.status(400).json({ error: "Provide either 'stock' or 'delta'" });
  }

  db.products[idx].stock =
    stock !== undefined ? Number(stock) : db.products[idx].stock + Number(delta);
  db.products[idx].updatedAt = new Date().toISOString();
  writeDb(db);

  res.json({ data: db.products[idx] });
});

// DELETE /api/products/:id (protected)
router.delete("/:id", requireAuth, (req, res) => {
  const db = readDb();
  const idx = db.products.findIndex((p) => String(p.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Product not found" });

  const [removed] = db.products.splice(idx, 1);
  writeDb(db);

  res.json({ data: removed });
});

module.exports = router;
