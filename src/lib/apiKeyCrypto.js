// Generation/hashing for developer API keys (Garment Tool API access).
//
// We never store the plaintext key anywhere, only a sha256 hash of it —
// same principle as passwordHash on User, except we don't need bcrypt's
// deliberate slowness here: the key itself already has ~190 bits of
// entropy (32 random bytes, base64url), so a fast hash is fine and lets
// the lookup-by-key path (every single API request) stay cheap.
const crypto = require("crypto");

const KEY_PREFIX = "fn_live_";
// How much of the key we store/display in plaintext so a user can tell
// their keys apart in the dashboard without us ever holding the secret.
const VISIBLE_PREFIX_LENGTH = KEY_PREFIX.length + 8;

function generateApiKey() {
  const secret = crypto.randomBytes(32).toString("base64url");
  const fullKey = `${KEY_PREFIX}${secret}`;
  return {
    fullKey, // show this to the user ONCE, in the create-key response only
    keyPrefix: fullKey.slice(0, VISIBLE_PREFIX_LENGTH), // safe to store/display
    keyHash: hashApiKey(fullKey),
  };
}

function hashApiKey(fullKey) {
  return crypto.createHash("sha256").update(fullKey).digest("hex");
}

function looksLikeApiKey(value) {
  return typeof value === "string" && value.startsWith(KEY_PREFIX) && value.length > VISIBLE_PREFIX_LENGTH;
}

module.exports = { generateApiKey, hashApiKey, looksLikeApiKey, KEY_PREFIX };
