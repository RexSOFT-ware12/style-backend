const ApiSubscription = require("../models/ApiSubscription");
const User = require("../models/User");
const { OVERAGE } = require("./apiTiers");
const { decrypt } = require("./secretsStore");
const { chargeAuthorization, getConfiguredAmountMinor, getCurrency, overageReference, verifyTransaction } = require("./paystack");

async function reportOverageUnit(apiSub, type, idempotencyKey) {
  const config = OVERAGE[type];
  if (!config) throw new Error(`Unknown overage type "${type}" — expected "segmented" or "bgOnly".`);
  const amountMinor = getConfiguredAmountMinor(config.amountEnvVar);
  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.error("API overage was not billed: PAYSTACK_SECRET_KEY is not configured.", { type, idempotencyKey });
    return false;
  }

  const reference = overageReference(idempotencyKey);
  try {
    const subscription = await ApiSubscription.findById(apiSub._id).select("+paystackAuthorizationCode");
    const user = await User.findById(apiSub.userId).select("email");
    if (!subscription?.paystackAuthorizationCode || !user?.email) {
      console.error("API overage was not billed: Paystack authorization or customer email is missing.", {
        type,
        userId: String(apiSub.userId),
        reference,
      });
      return false;
    }

    try {
      const previous = await verifyTransaction(reference);
      if (
        previous.status === "success" &&
        Number(previous.amount) === amountMinor &&
        String(previous.currency).toUpperCase() === getCurrency()
      ) {
        return true;
      }
      if (previous.status === "success") {
        throw new Error(`Previous Paystack overage transaction ${reference} has a different amount or currency.`);
      }
      throw new Error(`Previous Paystack overage transaction ${reference} is ${previous.status}.`);
    } catch (error) {
      if (error.statusCode !== 404 && !/(transaction|reference).*(not found|does not exist)/i.test(error.message)) throw error;
    }

    const transaction = await chargeAuthorization({
      email: user.email,
      authorizationCode: decrypt(subscription.paystackAuthorizationCode),
      amount: amountMinor,
      reference,
      metadata: { type: "api_overage", overageType: type, apiSubscriptionId: String(apiSub._id) },
    });

    if (transaction.status !== "success") {
      throw new Error(`Paystack overage charge ${reference} returned status "${transaction.status}".`);
    }
    return true;
  } catch (error) {
    console.error("Failed to charge API overage through Paystack; reconciliation is required.", {
      type,
      userId: String(apiSub.userId),
      reference,
      error: error.message,
    });
    return false;
  }
}

module.exports = { reportOverageUnit };
