const express = require("express");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const { signToken, requireAuth } = require("../middleware/auth");

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Some historical user records (e.g. imported from a previous, non-Mongo
// auth system) have a non-ObjectId `_id` — a Firebase-style uid rather than
// a 24-char hex string. Mongoose can't even hydrate such a document (it
// throws a CastError the moment it tries to build the Document, before any
// .save() happens), so we detect this shape up front with a plain regex
// rather than letting it blow up mid-request.
function isValidObjectId(id) {
  return /^[a-f\d]{24}$/i.test(String(id));
}

// POST /api/auth/signup — used by the dashboard's signup.html and the storefront's /signup
router.post("/signup", async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() }).lean();
    if (existing) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });

    const token = signToken({ id: user.id, name: user.name, email: user.email });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email }, isNewUser: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/signin — used by the dashboard's signin.html and the storefront's /signin
router.post("/signin", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).lean();
    if (!user || !user.passwordHash) {
      // Same generic message whether the account doesn't exist or is a
      // Google-only account with no password — don't leak which case it is.
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    // .lean() above returns a plain object, so build `id` from `_id`
    // ourselves rather than relying on Mongoose's `.id` virtual.
    const id = String(user._id);
    const token = signToken({ id, name: user.name, email: user.email });
    res.json({ token, user: { id, name: user.name, email: user.email }, isNewUser: false });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/google — used by the "Sign in with Google" button on both
// the storefront's /signin and /signup pages (it's the same endpoint for
// both: Google sign-in creates the account on first use, signs it in on
// every use after).
//
// Body: { credential } — the ID token string handed back by Google
// Identity Services' client-side button, NOT an access token. Verified
// server-side against GOOGLE_CLIENT_ID before trusting anything in it.
router.post("/google", async (req, res, next) => {
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ error: "credential is required" });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: "Google sign-in isn't configured on the server yet." });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({ error: "Google sign-in couldn't be verified. Please try again." });
    }

    if (!payload?.sub || !payload?.email) {
      return res.status(401).json({ error: "Google didn't return the expected account details." });
    }
    if (payload.email_verified === false) {
      return res.status(401).json({ error: "That Google account's email isn't verified." });
    }

    const email = payload.email.toLowerCase();

    // 1) Already linked by googleId — the common case on every sign-in
    //    after the first.
    let user = await User.findOne({ googleId: payload.sub });
    let isNewUser = false;

    if (!user) {
      // 2) No googleId match, but an account with this email already
      //    exists (e.g. they originally signed up with a password) — link
      //    Google to that same account rather than erroring or creating a
      //    duplicate.
      //
      //    Read with .lean() first: it skips Mongoose's document hydration,
      //    so a legacy record with a non-ObjectId _id (see isValidObjectId
      //    above) comes back as a plain object instead of throwing a
      //    CastError before we even get a chance to handle it.
      const existingRaw = await User.findOne({ email }).lean();

      if (existingRaw && isValidObjectId(existingRaw._id)) {
        // Normal case: a real account just needs Google linked to it.
        user = await User.findById(existingRaw._id);
        user.googleId = payload.sub;
        if (!user.avatarUrl && payload.picture) user.avatarUrl = payload.picture;
        await user.save();
      } else if (existingRaw) {
        // Legacy record with a foreign/corrupt _id that Mongoose can never
        // load as a real Document. One-time repair: recreate it under a
        // fresh, schema-valid ObjectId (carrying its existing fields over),
        // link Google to the new record, then remove the old one. The old
        // _id is deleted via the raw driver — Mongoose's own query casting
        // would reject that same non-ObjectId string just as document
        // hydration did.
        const { _id: legacyId, ...rest } = existingRaw;
        await User.collection.deleteOne({ _id: legacyId });
        try {
          user = await User.create({
            ...rest,
            googleId: payload.sub,
            avatarUrl: rest.avatarUrl || payload.picture,
          });
        } catch (migrateErr) {
          // Extremely unlikely (create() failing right after a successful
          // delete), but don't silently lose the account's data if it does.
          console.error("Failed to migrate legacy user record; original data:", rest, migrateErr);
          throw migrateErr;
        }
      }
    }

    if (!user) {
      // 3) Genuinely new — create a Google-only account (no passwordHash).
      user = await User.create({
        name: payload.name || payload.given_name || email.split("@")[0],
        email,
        googleId: payload.sub,
        avatarUrl: payload.picture,
      });
      isNewUser = true;
    }

    const token = signToken({ id: user.id, name: user.name, email: user.email });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email }, isNewUser });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — validates a token, used to keep sessions alive on both
// the dashboard and the storefront (and to decide what "Log out" shows).
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user.sub, name: req.user.name, email: req.user.email } });
});

// PUT /api/auth/me — updates the signed-in user's display name (storefront
// account-details page). Email is intentionally not editable here — it's
// also the sign-in identifier, so changing it needs its own re-verification
// flow rather than a plain field edit.
router.put("/me", requireAuth, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.name = name.trim();
    await user.save();

    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/change-password — requires the current password, same as
// any standard "change password" flow, so a hijacked-but-still-logged-in
// session token alone isn't enough to lock the real owner out.
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters" });
    }

    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
