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
  const currency = (process.env.PAYSTACK_CURRENCY || "USD").toUpperCase();
  if (currency !== "USD") {
    const error = new Error("PAYSTACK_CURRENCY must be USD until pricing is configured for another currency.");
    error.statusCode = 503;
    error.code = "PAYSTACK_CURRENCY_UNSUPPORTED";
    throw error;
  }
  return currency;
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

function initializeTransaction({ email, amount, planCode, callbackUrl, metadata }) {
  return request("/transaction/initialize", {
    method: "POST",
    body: {
      email,
      amount: String(amount),
      currency: getCurrency(),
      ...(planCode ? { plan: planCode } : {}),
      callback_url: callbackUrl,
      metadata,
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
      metadata,
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
  disableSubscription,
  getCurrency,
  getPlan,
  initializeTransaction,
  overageReference,
  verifyTransaction,
  verifyWebhookSignature,
};
