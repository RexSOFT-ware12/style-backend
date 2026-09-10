// Gates the paid tools: Garment Tool, Pose Tool, and SVG customization.
// Mount AFTER requireAuth — needs req.user.sub from the verified JWT.
//
// Deliberately re-reads the user from the DB on every request rather than
// trusting anything in the JWT: plan/subscriptionStatus can change at any
// moment (webhook from Stripe, trial expiring) and tokens live for 7 days,
// so the token itself is never a safe source of truth for entitlement.
const User = require("../models/User");
const { getEntitlement } = require("../lib/entitlement");

async function requirePremium(req, res, next) {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(401).json({ error: "Invalid or expired token" });

    const entitlement = getEntitlement(user);
    if (!entitlement.hasAccess) {
      // 402 Payment Required — a real, if under-used, HTTP status for
      // exactly this situation. The frontend keys off `code` to show the
      // upgrade paywall rather than a generic error toast.
      return res.status(402).json({
        error:
          entitlement.plan === "premium"
            ? "Your subscription isn't active — please update billing to keep using this tool."
            : "Your 3-day free trial has ended — upgrade to keep using this tool.",
        code: "UPGRADE_REQUIRED",
        trialEndsAt: entitlement.trialEndsAt,
      });
    }

    req.entitlement = entitlement;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requirePremium };
