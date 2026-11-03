const { Schema, model } = require("mongoose");

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Optional now: accounts created via "Sign in with Google" have no
    // password at all until/unless the person sets one later.
    passwordHash: { type: String, required: false },
    // Google's stable per-user "sub" claim. Sparse+unique so it's only
    // enforced unique among documents that actually have one (password-only
    // accounts simply omit this field).
    googleId: { type: String, required: false, unique: true, sparse: true },
    avatarUrl: { type: String, required: false },
    companyName: { type: String, trim: true, default: "" },

    // --- Freemium / premium gating -----------------------------------
    // Garment Tool, Pose Tool, and SVG customization (on the Design
    // Patterns page) are all gated: free for 3 days from signup, then
    // require an active premium subscription. `trialEndsAt` is stamped
    // once at account creation and never touched again — recomputing it
    // anywhere else would let someone extend their own trial.
    trialEndsAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    },
    plan: { type: String, enum: ["free", "premium"], default: "free" },
    // Provider status copied from Paystack subscription and invoice events.
    subscriptionStatus: {
      type: String,
      enum: ["none", "active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired"],
      default: "none",
    },
    paystackCustomerCode: { type: String, required: false },
    paystackSubscriptionCode: { type: String, required: false },
    paystackEmailToken: { type: Schema.Types.Mixed, required: false, select: false },
    paystackAuthorizationCode: { type: Schema.Types.Mixed, required: false, select: false },
    // Keep the legacy value so existing Stripe records remain identifiable
    // and don't receive Paystack entitlements until they re-subscribe.
    subscriptionProvider: { type: String, enum: ["paystack", "stripe"], required: false },
    subscriptionCancelAtPeriodEnd: { type: Boolean, default: false },
    subscriptionCurrentPeriodEnd: { type: Date, required: false },

    // Cached from the Paystack plan/transaction that is actually billing
    // this user, rather than from the current plan configuration.
    premiumPlanCode: { type: String, required: false },
    premiumUnitAmountCents: { type: Number, required: false },

    // --- Admin dashboard controls ------------------------------------
    // "admin" users can open the admin pages (users, API keys, manual API
    // subscriptions). Emails listed in the ADMIN_EMAILS env var are also
    // treated as admins even without this flag (see middleware/auth.js),
    // which is how the very first admin gets bootstrapped.
    role: { type: String, enum: ["user", "admin"], default: "user", index: true },
    // Blocked users can't sign in, and any token they already hold stops
    // working on the next request (requireAuth checks this).
    isBlocked: { type: Boolean, default: false, index: true },
    blockedAt: { type: Date, required: false },
    blockedReason: { type: String, required: false, trim: true, maxlength: 300 },
    blockedBy: { type: Schema.Types.ObjectId, ref: "User", required: false },

    // Recognised devices/locations for sign-in alert emails (see
    // lib/notify.js). Capped at 30 entries; hidden from normal queries.
    signIns: { type: [Schema.Types.Mixed], default: undefined, select: false },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = model("User", userSchema);
