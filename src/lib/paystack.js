const crypto = require("crypto");

const API_URL = "https://api.paystack.co";

function getSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    const error = new Error("Payments aren't configured yet. Set PAYSTACK_SECRET_KEY.");
    error.statusCode = 503;
    error.code = "PAYSTACK_SECRET_MISSING";
    throw error;
  }
  return key;
}

async function request(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const result = await response.json();

    if (!response.ok || !result.status) {
      const error = new Error(result.message || `Paystack request failed with status ${response.status}.`);
      error.statusCode = response.status;
      error.code = "PAYSTACK_API_ERROR";
      throw error;
    }

    return result.data;
  } catch (error) {
    if (error.statusCode) throw error;
    const networkError = new Error(
      error.name === "AbortError" ? "Paystack request timed out." : "Could not connect to Paystack."
    );
    networkError.statusCode = error.name === "AbortError" ? 504 : 502;
    networkError.code = "PAYSTACK_NETWORK_ERROR";
    throw networkError;
  } finally {
    clearTimeout(timeout);
  }
}

function getCurrency() {
  // Ghana Paystack integrations transact and settle in GHS. USD is a
  // storefront display currency only; never send USD to a Ghana account.
  const currency = (process.env.PAYSTACK_CURRENCY || "GHS").toUpperCase();
  if (currency !== "GHS") {
    const error = new Error("Ghana Paystack billing must use GHS. Keep USD for storefront display only.");
    error.statusCode = 503;
    error.code = "PAYSTACK_CURRENCY_UNSUPPORTED";
    throw error;
  }
  return "GHS";
}

function getConfiguredAmountMinor(envName) {
  const raw = process.env[envName];
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
    const error = new Error(`${envName} must be set to a positive amount with no more than 2 decimal places.`);
    error.statusCode = 503;
    error.code = raw ? "PAYSTACK_PRICE_INVALID" : "PAYSTACK_PRICE_MISSING";
    throw error;
  }
  return Math.round(amount * 100);
}

function getUsdGhsRate() {
  const rate = Number(process.env.PAYSTACK_USD_GHS_RATE);
  if (!Number.isFinite(rate) || rate <= 0) {
    const error = new Error("PAYSTACK_USD_GHS_RATE must be set to the GHS conversion rate for USD catalog prices.");
    error.statusCode = 503;
    error.code = "PAYSTACK_FX_RATE_MISSING";
    throw error;
  }
  return rate;
}

function convertUsdToPaystackMinor(amountUsd) {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    throw new Error("Order amount must be a non-negative USD amount.");
  }
  const amount = amountUsd * getUsdGhsRate();
  return Math.round(amount * 100);
}

async function getPlan(planCode, expectedAmount) {
  if (!planCode) throw new Error("Paystack plan code is missing from the server configuration.");
  const plan = await request(`/plan/${encodeURIComponent(planCode)}`);

  if (
    Number(plan.amount) !== expectedAmount ||
    String(plan.currency).toUpperCase() !== getCurrency() ||
    plan.interval !== "monthly"
  ) {
    const error = new Error(
      `Paystack plan ${planCode} must be a monthly ${getCurrency()} plan for ${expectedAmount} minor units; received ${plan.amount} ${plan.currency} per ${plan.interval}.`
    );
    error.statusCode = 503;
    error.code = "PAYSTACK_PLAN_MISMATCH";
    throw error;
  }

  return plan;
}

// Every Paystack transaction created here is tagged so the central gateway (FabricNow Pay)
// can route its webhook events back to this app. Paystack has ONE webhook per account.
const APPLICATION = "style";

function initializeTransaction({ email, amount, planCode, callbackUrl, metadata }) {
  return request("/transaction/initialize", {
    method: "POST",
    body: {
      email,
      amount: String(amount),
      currency: getCurrency(),
      ...(planCode ? { plan: planCode } : {}),
      callback_url: callbackUrl,
      // Let Paystack show every payment channel enabled and eligible for this account.
      metadata: { application: APPLICATION, ...metadata },
    },
  });
}

function verifyTransaction(reference) {
  return request(`/transaction/verify/${encodeURIComponent(reference)}`);
}

function chargeAuthorization({ email, authorizationCode, amount, reference, metadata }) {
  return request("/transaction/charge_authorization", {
    method: "POST",
    body: {
      email,
      authorization_code: authorizationCode,
      amount: String(amount),
      currency: getCurrency(),
      reference,
      metadata: { application: APPLICATION, ...metadata },
    },
  });
}

function disableSubscription(code, token) {
  return request("/subscription/disable", {
    method: "POST",
    body: { code, token },
  });
}

function verifyWebhookSignature(rawBody, signature) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature)) {
    return false;
  }
  const expected = crypto.createHmac("sha512", getSecretKey()).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function overageReference(idempotencyKey) {
  return `fn-${crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)}`;
}

module.exports = {
  chargeAuthorization,
  convertUsdToPaystackMinor,
  disableSubscription,
  getConfiguredAmountMinor,
  getCurrency,
  getPlan,
  getUsdGhsRate,
  initializeTransaction,
  overageReference,
  verifyTransaction,
  verifyWebhookSignature,
};
