// Authenticates a request by developer API key (fn_live_...), for clients that
// cannot hold a browser session — currently the FabricNow v2 desktop app.
//
// Accepts   x-api-key: fn_live_...     or     Authorization: Bearer fn_live_...
// On success sets: req.user = { sub, via: "api-key" }, req.apiKey, req.apiEntitlement.
//
// Same checks as /api/billing/api-key-status (key exists + not revoked, owner
// not blocked, active API subscription) so the two paths can never disagree.
const ApiKey = require("../models/ApiKey");
const ApiSubscription = require("../models/ApiSubscription");
const User = require("../models/User");
const { hashApiKey, looksLikeApiKey } = require("../lib/apiKeyCrypto");
const { getApiEntitlement } = require("../lib/apiEntitlement");

function extractKey(req) {
  const h = req.headers["x-api-key"];
  if (typeof h === "string" && h.trim()) return h.trim();
  const a = req.headers.authorization;
  if (typeof a === "string" && /^Bearer\s+fn_live_/i.test(a)) return a.slice(7).trim();
  return null;
}

async function requireApiKey(req, res, next) {
  try {
    const raw = extractKey(req);
    if (!raw) return res.status(401).json({ error: "Missing API key. Send it in the x-api-key header.", code: "API_KEY_MISSING" });
    if (!looksLikeApiKey(raw)) return res.status(401).json({ error: "That does not look like a FabricNow API key.", code: "API_KEY_INVALID" });

    const key = await ApiKey.findOne({ keyHash: hashApiKey(raw) });
    if (!key || key.revokedAt) return res.status(401).json({ error: "Invalid or revoked API key.", code: "API_KEY_INVALID" });

    const owner = await User.findById(key.userId).select("isBlocked email name").lean();
    if (!owner) return res.status(401).json({ error: "Invalid or revoked API key.", code: "API_KEY_INVALID" });
    if (owner.isBlocked) return res.status(403).json({ error: "This account has been suspended.", code: "ACCOUNT_BLOCKED" });

    const apiSub = await ApiSubscription.findOne({ userId: key.userId });
    const entitlement = getApiEntitlement(apiSub);
    if (!entitlement.hasAccess) {
      return res.status(402).json({ error: "This account's API subscription isn't active — please update billing.", code: "UPGRADE_REQUIRED" });
    }

    ApiKey.updateOne({ _id: key.id }, { lastUsedAt: new Date() }).catch(() => {});
    req.user = { sub: String(key.userId), email: owner.email, name: owner.name, via: "api-key" };
    req.apiKey = { id: String(key.id), prefix: key.keyPrefix, label: key.label };
    req.apiEntitlement = entitlement;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireApiKey, extractKey };
