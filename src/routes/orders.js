const express = require("express");
const path = require("path");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { requireAuth } = require("../middleware/auth");
const { DIGITAL_DIR } = require("../middleware/upload");
const { streamObject } = require("../lib/gcs");

const router = express.Router();

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;

function serializeOrder(order) {
  const obj = order.toJSON ? order.toJSON() : order;
  return {
    id: obj.id,
    status: obj.status,
    total: obj.total,
    items: obj.items.map((i) => ({
      productId: String(i.productId),
      name: i.name,
      price: i.price,
      quantity: i.quantity,
    })),
    createdAt: obj.createdAt,
    paidAt: obj.paidAt || null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/orders/checkout  (auth required)
// Body: { items: [{ productId, quantity }] }
// Creates a pending order priced from server-side product data (never trust
// client-submitted prices), then a Stripe Checkout Session for it. These are
// digital goods — no shipping/address collection.
// ---------------------------------------------------------------------------
router.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    if (!stripe) {
      return res.status(500).json({
        error: "Payments aren't configured yet. Set STRIPE_SECRET_KEY on the server.",
      });
    }

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items must be a non-empty array" });
    }

    const lineItems = [];
    const orderItems = [];

    for (const { productId, quantity } of items) {
      const product = await Product.findById(productId).catch(() => null);
      if (!product) {
        return res.status(400).json({ error: `Product ${productId} not found` });
      }
      if (!product.digitalFile) {
        return res.status(400).json({ error: `${product.name} has no digital file to deliver` });
      }
      const qty = Math.max(1, Number(quantity) || 1);

      orderItems.push({
        productId: product._id,
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

    const order = await Order.create({
      userId: req.user.sub,
      items: orderItems,
      total,
      status: "pending",
    });

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
    await order.save();

    res.json({ url: session.url, orderId: order.id });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/orders/webhook  (Stripe only — mounted with raw body in server.js)
// Marks the matching order paid once Stripe confirms payment succeeded.
// ---------------------------------------------------------------------------
router.post("/webhook", async (req, res) => {
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

    try {
      const order = await Order.findOne({
        $or: [{ _id: orderId }, { stripeSessionId: session.id }].filter((c) => c._id || c.stripeSessionId),
      });
      if (order && order.status !== "paid") {
        order.status = "paid";
        order.paidAt = new Date();
        await order.save();
      }
    } catch (err) {
      console.error("Failed to mark order paid:", err.message);
    }
  }

  res.json({ received: true });
});

// ---------------------------------------------------------------------------
// GET /api/orders/me  (auth required) — "My Purchases" page data
// ---------------------------------------------------------------------------
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const orders = await Order.find({ userId: req.user.sub }).sort({ createdAt: -1 });
    res.json({ data: orders.map(serializeOrder) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:orderId/download/:productId  (auth required)
// The actual digital delivery: only works if the order belongs to the
// requesting user, is marked paid, and contains that product.
// ---------------------------------------------------------------------------
router.get("/:orderId/download/:productId", requireAuth, async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.orderId).catch(() => null);

    if (!order || String(order.userId) !== String(req.user.sub)) {
      return res.status(404).json({ error: "Order not found" });
    }
    if (order.status !== "paid") {
      return res.status(402).json({ error: "This order hasn't been paid yet" });
    }

    const item = order.items.find((i) => String(i.productId) === String(req.params.productId));
    if (!item) {
      return res.status(404).json({ error: "That product isn't part of this order" });
    }

    const product = await Product.findById(req.params.productId).catch(() => null);
    if (!product?.digitalFile) {
      return res.status(404).json({ error: "No digital file is attached to this product" });
    }

    const downloadName = product.digitalFile.originalName || `${product.name}.zip`;

    // Files uploaded through the direct GCS upload flow live in GCS, not on
    // this instance's local disk (which is ephemeral on App Engine anyway).
    if (product.digitalFile.storage === "gcs") {
      const found = await streamObject(product.digitalFile.fileName, res, downloadName);
      if (!found) return res.status(404).json({ error: "Digital file is missing from storage" });
      return;
    }

    // Backward compatibility: older products whose .zip was saved to local
    // disk via multer before this endpoint supported direct GCS uploads.
    const filePath = path.join(DIGITAL_DIR, product.digitalFile.fileName);
    res.download(filePath, downloadName, (err) => {
      if (err && !res.headersSent) {
        console.error("Download error:", err);
        res.status(500).json({ error: "Could not deliver the file" });
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;