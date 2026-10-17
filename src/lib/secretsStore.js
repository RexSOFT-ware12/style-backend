// Lets an admin change provider keys (OpenAI, Claude, Gemini, ...) from the
// dashboard without editing .env or redeploying.
//
// How it works: values saved from the dashboard live encrypted in MongoDB
// (models/AppSecret.js). On startup — and every minute after, so every App
// Engine instance converges — they're decrypted and written over the matching
// process.env.X. All the existing code that already reads process.env.X at
// call time (gemini.js, garmentTool.js, inspirationLibrary.js, ...) keeps
// working untouched and simply sees the new value. Deleting a dashboard value
// restores whatever the original environment variable was.
const crypto = require("crypto");
const AppSecret = require("../models/AppSecret");
const { FIELD_BY_NAME, PROVIDER_GROUPS } = require("./providerRegistry");

const REFRESH_MS = 60 * 1000;

// What each variable was before any dashboard override touched it.
const originalEnv = new Map();
for (const name of FIELD_BY_NAME.keys()) originalEnv.set(name, process.env[name]);

function encKey() {
  const material = process.env.SECRETS_ENCRYPTION_KEY || process.env.JWT_SECRET || "fabricnow-dev-secret-change-me";
  return crypto.createHash("sha256").update(String(material)).digest(); // 32 bytes
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return { enc: enc.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decrypt({ enc, iv, tag }) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64")), decipher.final()]).toString("utf8");
}

const overrides = new Map(); // name -> { updatedAt }

/** Re-reads every dashboard-set value and applies it to process.env. */
async function refreshSecrets() {
  const docs = await AppSecret.find({ name: { $in: [...FIELD_BY_NAME.keys()] } }).lean();
  const seen = new Set();

  for (const doc of docs) {
    let value;
    try {
      value = doc.isSecret ? decrypt(doc) : doc.value;
    } catch (err) {
      // Wrong/rotated SECRETS_ENCRYPTION_KEY — keep using the env value rather than crash.
      console.error(`secretsStore: could not decrypt ${doc.name} (was the encryption key changed?)`);
      continue;
    }
    if (typeof value !== "string" || !value) continue;
    process.env[doc.name] = value;
    overrides.set(doc.name, { updatedAt: doc.updatedAt });
    seen.add(doc.name);
  }

  // Anything no longer overridden (cleared on another instance) goes back to the env value.
  for (const name of [...overrides.keys()]) {
    if (seen.has(name)) continue;
    restoreOriginal(name);
  }
}

function restoreOriginal(name) {
  const orig = originalEnv.get(name);
  if (orig === undefined) delete process.env[name];
  else process.env[name] = orig;
  overrides.delete(name);
}

let timer = null;
async function initSecrets() {
  try {
    await refreshSecrets();
  } catch (err) {
    console.error("secretsStore: initial load failed — using environment values only:", err.message);
  }
  if (!timer) {
    timer = setInterval(() => refreshSecrets().catch((e) => console.error("secretsStore refresh failed:", e.message)), REFRESH_MS);
    timer.unref?.();
  }
}

function validateValue(field, raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { error: "Value can't be empty. Use Remove to go back to the server default." };
  if (value.length > 4000) return { error: "That value is too long." };
  if (/\s/.test(value) && field.secret) return { error: "Keys can't contain spaces or line breaks — check for a stray paste." };
  return { value };
}

async function setSecret(name, raw, userId) {
  const field = FIELD_BY_NAME.get(name);
  if (!field) throw Object.assign(new Error("Unknown setting."), { status: 400 });
  const v = validateValue(field, raw);
  if (v.error) throw Object.assign(new Error(v.error), { status: 400 });

  const doc = {
    name,
    isSecret: !!field.secret,
    last4: field.secret ? v.value.slice(-4) : undefined,
    updatedBy: userId,
  };
  if (field.secret) Object.assign(doc, encrypt(v.value), { value: undefined });
  else Object.assign(doc, { value: v.value, enc: undefined, iv: undefined, tag: undefined });

  await AppSecret.findOneAndUpdate({ name }, { $set: doc }, { upsert: true, new: true, setDefaultsOnInsert: true });
  process.env[name] = v.value; // effective immediately on this instance
  overrides.set(name, { updatedAt: new Date() });
}

async function clearSecret(name) {
  if (!FIELD_BY_NAME.has(name)) throw Object.assign(new Error("Unknown setting."), { status: 400 });
  await AppSecret.deleteOne({ name });
  restoreOriginal(name);
}

/** What the dashboard shows. Secret values are NEVER included — only the last 4 characters. */
async function describeAll() {
  const docs = await AppSecret.find({ name: { $in: [...FIELD_BY_NAME.keys()] } }).lean();
  const byName = new Map(docs.map((d) => [d.name, d]));

  return PROVIDER_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    description: g.description,
    fields: g.fields.map((f) => {
      const doc = byName.get(f.name);
      const effective = process.env[f.name];
      const source = doc ? "dashboard" : effective ? "server" : "unset";
      return {
        name: f.name,
        label: f.label,
        secret: !!f.secret,
        needsRestart: !!f.needsRestart,
        sharedWithGarmentService: !!f.sharedWithGarmentService,
        placeholder: f.placeholder || "",
        source, // dashboard = set here, server = from .env/secrets.yaml, unset = nothing
        isSet: source !== "unset",
        last4: f.secret ? (doc?.last4 || (effective ? String(effective).slice(-4) : "")) : "",
        value: f.secret ? undefined : effective || "", // non-secret settings (model names) are fine to show
        updatedAt: doc?.updatedAt || null,
      };
    }),
  }));
}

module.exports = { initSecrets, refreshSecrets, setSecret, clearSecret, describeAll };
