const crypto = require("crypto");
const PaymentEvent = require("../models/PaymentEvent");
const billingRouter = require("./billing");
const ordersRouter = require("./orders");

// Receiver for events forwarded by the central FabricNow Pay gateway.
//
//   Paystack --(x-paystack-signature)--> Pay-Now --(X-Fabric-Pay-Signature)--> THIS ROUTE
//
// The gateway has already verified Paystack's signature. Here we verify the
// gateway's own HMAC-SHA256 (shared secret FABRIC_PAY_EVENT_SECRET), then hand
// the ORIGINAL Paystack event to the same handlers the old /api/paystack/webhook
// used, so Premium, API tiers, overages and digital orders behave exactly as before.

const LOCK_TTL_MS = 2 * 60 * 1000;

function verifyFabricPay(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || !secret || typeof signature !== "string") return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(raw).digest("hex"));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// Mount with express.raw({ type: "application/json" }) BEFORE express.json().
async function handleFabricPayEvent(req, res) {
  const secret = process.env.FABRIC_PAY_EVENT_SECRET;
  if (!secret) {
    console.error("FABRIC_PAY_EVENT_SECRET is not set; cannot accept gateway events.");
    return res.status(503).json({ error: "Gateway events are not configured." });
  }
  if (!verifyFabricPay(req.body, req.get("X-Fabric-Pay-Signature"), secret)) {
    return res.status(401).json({ error: "Invalid signature." });
  }

  let envelope;
  try {
    envelope = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON." });
  }
  const { eventId, payload } = envelope || {};
  if (!eventId || !payload?.event) return res.status(400).json({ error: "eventId and payload.event are required." });

  // Claim the event. If it is already done, or another worker holds a fresh lock, we do not process it again.
  let claimed = null;
  try {
    claimed = await PaymentEvent.findOneAndUpdate(
      {
        eventId,
        status: { $ne: "done" },
        $or: [{ lockedAt: null }, { lockedAt: { $lt: new Date(Date.now() - LOCK_TTL_MS) } }],
      },
      {
        $set: { status: "processing", lockedAt: new Date(), event: payload.event, reference: payload.data?.reference || null },
        $setOnInsert: { eventId },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    if (err.code !== 11000) {
      console.error("Could not record gateway event:", err.message);
      return res.status(500).json({ error: "Could not record event." });
    }
  }
  if (!claimed) {
    const existing = await PaymentEvent.findOne({ eventId }).select("status");
    if (existing?.status === "done") return res.json({ received: true, duplicate: true });
    return res.status(409).json({ error: "Event is being processed." }); // gateway will retry later
  }

  try {
    await billingRouter.processPaystackEvent(payload); // Premium + API tier subscriptions, renewals, failed invoices
    await ordersRouter.processPaystackEvent(payload); // digital product orders
    await PaymentEvent.updateOne({ eventId }, { $set: { status: "done" }, $unset: { lockedAt: 1, lastError: 1 } });
    return res.json({ received: true });
  } catch (err) {
    console.error("Failed to process gateway event:", eventId, err.message);
    await PaymentEvent.updateOne({ eventId }, { $set: { status: "failed", lastError: String(err.message).slice(0, 500) }, $unset: { lockedAt: 1 } }).catch(() => {});
    // Non-2xx on purpose: the gateway keeps the event as "failed" and retries with backoff.
    return res.status(500).json({ error: "Processing failed." });
  }
}

module.exports = { handleFabricPayEvent, verifyFabricPay };
