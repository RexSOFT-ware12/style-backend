const jwt = require("jsonwebtoken");

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production (see style-backend/secrets.yaml.example).");
}
const JWT_SECRET = process.env.JWT_SECRET || "fabricnow-dev-secret-change-me";

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// ---------------------------------------------------------------------------
// Blocked / admin status
// ---------------------------------------------------------------------------
// A JWT stays cryptographically valid for 7 days, so "block this user" can't
// rely on the token alone — every authenticated request also checks the
// user's current status in the DB. To keep that cheap the result is cached
// in memory for a few seconds (and cleared immediately when an admin blocks /
// unblocks someone on this instance; other instances catch up within the TTL).
const STATUS_TTL_MS = 15 * 1000;
const statusCache = new Map(); // userId -> { at, isBlocked, role, email }

const isObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id));

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function loadStatus(userId) {
  const hit = statusCache.get(userId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit;

  // Legacy imported users (non-ObjectId ids) can't be loaded by Mongoose —
  // they were never blockable, so treat them as "not blocked".
  if (!isObjectId(userId)) return { isBlocked: false, role: "user", email: "" };

  const User = require("../models/User");
  const doc = await User.findById(userId).select("isBlocked role email").lean();
  const entry = {
    at: Date.now(),
    exists: !!doc,
    isBlocked: !!doc?.isBlocked,
    role: doc?.role || "user",
    email: doc?.email || "",
  };
  statusCache.set(userId, entry);
  if (statusCache.size > 5000) statusCache.clear(); // crude bound; it's only a cache
  return entry;
}

function clearStatusCache(userId) {
  if (userId) statusCache.delete(String(userId));
  else statusCache.clear();
}

const isAdminStatus = (st) => st.role === "admin" || adminEmails().includes(String(st.email || "").toLowerCase());

/**
 * Protects routes that need a signed-in user. Sends 401 if there's no valid
 * "Authorization: Bearer <token>" header, and 403 (code ACCOUNT_BLOCKED) if
 * an admin has blocked the account.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const st = await loadStatus(String(req.user.sub));
    if (st.isBlocked) {
      return res.status(403).json({
        error: "This account has been suspended. Please contact support.",
        code: "ACCOUNT_BLOCKED",
      });
    }
    req.userStatus = st;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Admin-only routes. Mount AFTER requireAuth. A user is an admin if their
 * User.role is "admin" OR their email is listed in ADMIN_EMAILS.
 */
async function requireAdmin(req, res, next) {
  try {
    const st = req.userStatus || (await loadStatus(String(req.user?.sub)));
    if (!isAdminStatus(st)) {
      return res.status(403).json({ error: "Admin access required.", code: "ADMIN_ONLY" });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { signToken, requireAuth, requireAdmin, clearStatusCache, isAdminStatus, adminEmails, JWT_SECRET };
