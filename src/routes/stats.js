const express = require("express");
const { readDb } = require("../db");

const router = express.Router();

const LOW_STOCK_THRESHOLD = 15;

// GET /api/stats — powers the dashboard's summary cards on index.html
router.get("/", (req, res) => {
  const db = readDb();
  const products = db.products;

  const totalProducts = products.length;
  const totalStockUnits = products.reduce((sum, p) => sum + (p.stock || 0), 0);
  const inventoryValue = products.reduce((sum, p) => sum + (p.stock || 0) * (p.price || 0), 0);
  const lowStock = products.filter((p) => p.stock <= LOW_STOCK_THRESHOLD);
  const categories = new Set(products.map((p) => p.category).filter(Boolean));

  const recentProducts = [...products]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  res.json({
    totalProducts,
    totalStockUnits,
    inventoryValue: Math.round(inventoryValue * 100) / 100,
    lowStockCount: lowStock.length,
    lowStockItems: lowStock,
    totalCategories: categories.size,
    recentProducts,
  });
});

module.exports = router;
