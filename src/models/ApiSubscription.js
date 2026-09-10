const { Schema, model } = require("mongoose");

// One per user (unique userId) — separate from the $19.99-29.99/mo consumer
// "Premium" plan tracked on User itself (plan/subscriptionStatus/trialEndsAt
// there). A user CAN hold both: a Premium sub for the dashboard tools and an
// ApiSubscription for programmatic access — they're billed as two separate
// Stripe subscriptions.
const apiSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    tier: { type: String, enum: ["starter", "growth", "enterprise"], required: true },

    // Mirrors Stripe's subscription status vocabulary, same convention as
    // User.subscriptionStatus — copied verbatim from webhook payloads.
    status: {
      type: String,
      enum: ["none", "active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired"],
      default: "none",
    },

    stripeCustomerId: { type: String, required: false },
    stripeSubscriptionId: { type: String, required: false },
    // Subscription item ids for the three line items on the Stripe
    // subscription: the flat monthly base fee, and the two metered overage
    // items (segmented / bg-only). Populated from the webhook once Stripe
    // confirms the subscription; enterprise deals with no self-serve
    // Checkout may have these set by hand, or left blank if overage isn't
    // part of that negotiated deal.
    stripeSubscriptionItemIds: {
      base: { type: String, required: false },
      overageSegmented: { type: String, required: false },
      overageBgOnly: { type: String, required: false },
    },

    // Included images for the CURRENT billing period. Copied from
    // lib/apiTiers.js at subscription-create time for starter/growth;
    // set by hand for enterprise. `null` = uncapped/no quota tracked
    // (only expected for a negotiated enterprise deal with no overage
    // billing at all).
    quota: { type: Number, required: false, default: null },

    // Stripe's `current_period_start/end` now live on the subscription
    // ITEM, not the subscription itself (Stripe API 2025-03-31.basil
    // removed the subscription-level fields) — these are copied from the
    // base line item's period on every relevant webhook. Used to detect
    // when to reset `usage` below for a new billing period.
    currentPeriodStart: { type: Date, required: false },
    currentPeriodEnd: { type: Date, required: false },

    // This-period usage counters, reset to 0 whenever a webhook shows the
    // period has rolled over. These are OUR bookkeeping for "has this key
    // used its included quota yet" — Stripe's own meters are the source of
    // truth for what actually gets invoiced, these just decide the instant
    // a given call crosses from "included" to "overage" (see
    // lib/stripeMeters.js).
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
