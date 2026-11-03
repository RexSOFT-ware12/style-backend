const { Schema, model } = require("mongoose");

// One per user (unique userId) — separate from the $19.99-29.99/mo consumer
// "Premium" plan tracked on User itself (plan/subscriptionStatus/trialEndsAt
// there). A user CAN hold both: a Premium sub for the dashboard tools and an
// ApiSubscription for programmatic access — they're billed separately.
const apiSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    tier: { type: String, enum: ["starter", "growth", "enterprise"], required: true },

    // Mirrors the billing provider status, copied from Paystack events.
    status: {
      type: String,
      enum: ["none", "active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired"],
      default: "none",
    },

    paystackCustomerCode: { type: String, required: false },
    paystackSubscriptionCode: { type: String, required: false },
    paystackEmailToken: { type: Schema.Types.Mixed, required: false, select: false },
    paystackAuthorizationCode: { type: Schema.Types.Mixed, required: false, select: false },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    billingAmountMinor: { type: Number, required: false },
    billingCurrency: { type: String, enum: ["GHS", "USD"], required: false },

    // Included images for the CURRENT billing period. Copied from
    // lib/apiTiers.js at subscription-create time for starter/growth;
    // set by hand for enterprise. `null` = uncapped/no quota tracked
    // (only expected for a negotiated enterprise deal with no overage
    // billing at all).
    quota: { type: Number, required: false, default: null },

    // Copied from Paystack subscription and invoice events; used to detect
    // when to reset `usage` below for a new billing period.
    currentPeriodStart: { type: Date, required: false },
    currentPeriodEnd: { type: Date, required: false },

    // How this subscription is paid for. "paystack" = recurring self-serve
    // billing; "manual" =
    // an admin marked it paid because the customer paid us directly; there
    // is no Paystack subscription behind it, so the admin records each
    // renewal from the dashboard (see routes/admin.js).
    // "stripe" is retained only to recognize and deny legacy records.
    source: { type: String, enum: ["paystack", "manual", "stripe"], required: false },
    // Audit info for manual payments (last recorded payment).
    manualPayment: {
      amountUsd: { type: Number, required: false },
      note: { type: String, required: false, maxlength: 500 },
      recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: false },
      recordedAt: { type: Date, required: false },
    },

    // UNUSED CREDITS THAT CARRIED OVER from earlier periods (plus any
    // credits an admin granted by hand). They never expire: at every
    // renewal the fresh monthly `quota` is added on top of whatever is left
    // here. Spendable allowance this period = quota + rolloverCredits —
    // see lib/apiCredits.js, which is the only place that does this maths.
    rolloverCredits: { type: Number, default: 0, min: 0 },

    // This-period usage counters, reset to 0 whenever a webhook shows the
    // period has rolled over. Crossing the allowance triggers a Paystack
    // authorization charge.
    usage: {
      segmentedCount: { type: Number, default: 0 },
      bgOnlyCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

apiSubscriptionSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = model("ApiSubscription", apiSubscriptionSchema);
