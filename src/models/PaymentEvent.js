const { Schema, model } = require("mongoose");

// One document per event forwarded by the central FabricNow Pay gateway.
// Used to make processing idempotent: the gateway retries on any non-2xx, and
// handlers such as billing.applySuccessfulCharge send invoice emails, so the
// same event must never be applied twice.
const paymentEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    event: { type: String },
    reference: { type: String },
    status: { type: String, enum: ["processing", "done", "failed"], default: "processing" },
    lockedAt: { type: Date },
    lastError: { type: String },
    // Housekeeping: keep a 90-day audit trail, then let MongoDB delete it.
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
  },
  { versionKey: false }
);

module.exports = model("PaymentEvent", paymentEventSchema);
