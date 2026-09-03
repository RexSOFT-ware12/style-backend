const express = require("express");
const path = require("path");
const { nanoid } = require("nanoid");
const { readDb, writeDb } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { DIGITAL_DIR } = require("../middleware/upload");

const router = express.Router();

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;

function serializeOrder(order) {
  return {
    id: order.id,
    status: order.status,
    total: order.total,
    items: order.items,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/orders/checkout  (auth required)
// Body: { items: [{ productId, quantity }] }
// Creates a pending order priced from server-side product data (never trust
// client-submitted prices), then a Stripe Checkout Session for it. These are
// digital goods — no shipping/address collection.
// ---------------------------------------------------------------------------
router.post("/checkout", requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({
      error: "Payments aren't configured yet. Set STRIPE_SECRET_KEY on the server.",
    });
  }

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }

  const db = readDb();

  const lineItems = [];
  const orderItems = [];

  for (const { productId, quantity } of items) {
    const product = db.products.find((p) => String(p.id) === String(productId));
    if (!product) {
      return res.status(400).json({ error: `Product ${productId} not found` });
    }
    if (!product.digitalFile) {
      return res.status(400).json({ error: `${product.name} has no digital file to deliver` });
    }
    const qty = Math.max(1, Number(quantity) || 1);

    orderItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: qty,
    });

    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: { name: product.name },
        unit_amount: Math.round(product.price * 100),
      },
      quantity: qty,
    });
  }

  const total = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const order = {
    id: nanoid(14),
    userId: req.user.sub,
    items: orderItems,
    total,
    status: "pending",
    stripeSessionId: null,
    createdAt: new Date().toISOString(),
    paidAt: null,
  };

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: lineItems,
    customer_email: req.user.email,
    // Digital delivery — no shipping address collection at all.
    success_url: `${FRONTEND_URL}/checkout/success?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${FRONTEND_URL}/checkout?canceled=1`,
    metadata: { orderId: order.id },
  });

  order.stripeSessionId = session.id;
  db.orders.push(order);
  writeDb(db);

  res.json({ url: session.url, orderId: order.id });
});

// ---------------------------------------------------------------------------
// POST /api/orders/webhook  (Stripe only — mounted with raw body in server.js)
// Marks the matching order paid once Stripe confirms payment succeeded.
// ---------------------------------------------------------------------------
router.post("/webhook", (req, res) => {
  if (!stripe) return res.status(500).send("Stripe not configured");

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
      : JSON.parse(req.body.toString("utf8")); // dev fallback if no signing secret set yet
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    const db = readDb();
    const order = db.orders.find((o) => o.id === orderId || o.stripeSessionId === session.id);
    if (order && order.status !== "paid") {
      order.status = "paid";
      order.paidAt = new Date().toISOString();
      writeDb(db);
    }
  }

  res.json({ received: true });
});

// ---------------------------------------------------------------------------
// GET /api/orders/me  (auth required) — "My Purchases" page data
// ---------------------------------------------------------------------------
router.get("/me", requireAuth, (req, res) => {
  const db = readDb();
  const orders = db.orders
    .filter((o) => o.userId === req.user.sub)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ data: orders.map(serializeOrder) });
});

// ---------------------------------------------------------------------------
// GET /api/orders/:orderId/download/:productId  (auth required)
// The actual digital delivery: only works if the order belongs to the
// requesting user, is marked paid, and contains that product.
// ---------------------------------------------------------------------------
router.get("/:orderId/download/:productId", requireAuth, (req, res) => {
  const db = readDb();
  const order = db.orders.find((o) => o.id === req.params.orderId);

  if (!order || order.userId !== req.user.sub) {
    return res.status(404).json({ error: "Order not found" });
  }
  if (order.status !== "paid") {
    return res.status(402).json({ error: "This order hasn't been paid yet" });
  }

  const item = order.items.find((i) => i.productId === req.params.productId);
  if (!item) {
    return res.status(404).json({ error: "That product isn't part of this order" });
  }

  const product = db.products.find((p) => p.id === req.params.productId);
  if (!product?.digitalFile) {
    return res.status(404).json({ error: "No digital file is attached to this product" });
  }

  const filePath = path.join(DIGITAL_DIR, product.digitalFile.fileName);
  const downloadName = product.digitalFile.originalName || `${product.name}.zip`;

  res.download(filePath, downloadName, (err) => {
    if (err && !res.headersSent) {
      console.error("Download error:", err);
      res.status(500).json({ error: "Could not deliver the file" });
    }
  });
});

module.exports = router;
