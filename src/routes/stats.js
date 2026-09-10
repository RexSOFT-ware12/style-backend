const express = require("express");
const Product = require("../models/Product");
const Order = require("../models/Order");

const router = express.Router();

// GET /api/stats — powers the dashboard's summary cards on index.html
router.get("/", async (req, res, next) => {
  try {
    const [products, orders] = await Promise.all([Product.find(), Order.find()]);

    const totalProducts = products.length;
    const categories = new Set(products.map((p) => p.category).filter(Boolean));

    const paidOrders = orders.filter((o) => o.status === "paid");
    const pendingOrders = orders.filter((o) => o.status === "pending");
    const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    const recentProducts = [...products]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);

    res.json({
      totalProducts,
      totalCategories: categories.size,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      paidOrdersCount: paidOrders.length,
      pendingOrdersCount: pendingOrders.length,
      recentProducts: recentProducts.map((p) => p.toJSON()),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
