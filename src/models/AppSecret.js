const { Schema, model } = require("mongoose");

// One document per provider key/setting an admin has set from the dashboard
// (OpenAI, Anthropic/Claude, Gemini, Hugging Face, ...). Secret values are
// stored AES-256-GCM encrypted (lib/secretsStore.js) — never plaintext, and
// never returned by any API (only `last4` is shown in the dashboard).
//
// A document here OVERRIDES the same-named environment variable at runtime.
// Deleting the document puts the original env value back.
const appSecretSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true }, // e.g. "OPENAI_API_KEY"
    isSecret: { type: Boolean, default: true },
    // Encrypted payload (secrets only). Non-secret settings (model names) keep `value`.
    enc: { type: String, required: false },
    iv: { type: String, required: false },
    tag: { type: String, required: false },
    value: { type: String, required: false },
    last4: { type: String, required: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: false },
  },
  { timestamps: true }
);

module.exports = model("AppSecret", appSecretSchema);
