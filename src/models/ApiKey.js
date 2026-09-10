const { Schema, model } = require("mongoose");

// A user can hold several of these (e.g. "prod", "staging") — they all draw
// from the same ApiSubscription's quota/usage, keyed by userId. Revoking one
// key never touches the others or the subscription itself.
const apiKeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // sha256 hex digest of the full key — see lib/apiKeyCrypto.js. NEVER
    // store the plaintext key; it's shown to the user exactly once, at
    // creation time, in the route handler's response body only.
    keyHash: { type: String, required: true, unique: true },
    // First ~16 chars of the plaintext key (e.g. "fn_live_ab12cd34"), kept
    // so the user can tell their keys apart in the dashboard without us
    // ever holding the full secret.
    keyPrefix: { type: String, required: true },
    label: { type: String, required: true, trim: true, default: "Untitled key" },
    lastUsedAt: { type: Date, required: false },
    revokedAt: { type: Date, required: false, default: null },
  },
  { timestamps: true }
);

apiKeySchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.keyHash; // never serialize this, even internally-triggered
    return ret;
  },
});

module.exports = model("ApiKey", apiKeySchema);
