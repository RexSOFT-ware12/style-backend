// Run: node --test test/fabricPayEvents.test.js   (no database needed; models/handlers are stubbed)
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("crypto"), path = require("path");

const calls = { billing: [], orders: [] };
let failBilling = false;
const store = new Map(); // eventId -> {status, lockedAt}

const stub = (rel, exports) => { const f = require.resolve(path.join(__dirname, "..", rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub("src/routes/billing.js", { processPaystackEvent: async (e) => { if (failBilling) throw new Error("boom"); calls.billing.push(e.event); } });
stub("src/routes/orders.js", { processPaystackEvent: async (e) => { calls.orders.push(e.event); } });
stub("src/models/PaymentEvent.js", {
  findOneAndUpdate: async (filter) => {
    const cur = store.get(filter.eventId);
    if (cur && cur.status === "done") { const e = new Error("dup"); e.code = 11000; throw e; }
    if (cur && cur.lockedAt && Date.now() - cur.lockedAt < 120000) { const e = new Error("dup"); e.code = 11000; throw e; }
    store.set(filter.eventId, { status: "processing", lockedAt: Date.now() }); return { eventId: filter.eventId };
  },
  findOne: () => ({ select: async () => ({ status: "processing" }) }),
  updateOne: async (f, u) => { const c = store.get(f.eventId) || {}; store.set(f.eventId, { ...c, status: u.$set.status, lockedAt: u.$unset?.lockedAt ? null : c.lockedAt }); },
});
const { handleFabricPayEvent, verifyFabricPay } = require("../src/routes/fabricPayEvents");

const SECRET = "s".repeat(40); process.env.FABRIC_PAY_EVENT_SECRET = SECRET;
const sign = (b, s = SECRET) => crypto.createHmac("sha256", s).update(b).digest("hex");
const mkReq = (obj, sig) => { const body = Buffer.from(JSON.stringify(obj)); return { body, get: () => sig ?? sign(body) }; };
const mkRes = () => { const r = { code: 200, json(b) { r.body = b; return r; }, status(c) { r.code = c; return r; } }; return r; };
const env = (id) => ({ eventId: id, event: "charge.success", payload: { event: "charge.success", data: { reference: "r1" } } });

test("rejects a wrong signature", async () => {
  const res = mkRes(); await handleFabricPayEvent(mkReq(env("a"), "0".repeat(64)), res);
  assert.equal(res.code, 401); assert.equal(calls.billing.length, 0);
});
test("valid event runs billing AND orders handlers with the original Paystack payload", async () => {
  const res = mkRes(); await handleFabricPayEvent(mkReq(env("b")), res);
  assert.equal(res.code, 200); assert.deepEqual(calls.billing, ["charge.success"]); assert.deepEqual(calls.orders, ["charge.success"]);
});
test("same eventId delivered twice is processed once", async () => {
  const res = mkRes(); await handleFabricPayEvent(mkReq(env("b")), res);
  assert.equal(calls.billing.length, 1);
});
test("handler failure returns 500 so the gateway retries, and a retry then succeeds", async () => {
  failBilling = true; let res = mkRes(); await handleFabricPayEvent(mkReq(env("c")), res);
  assert.equal(res.code, 500);
  failBilling = false; res = mkRes(); await handleFabricPayEvent(mkReq(env("c")), res);
  assert.equal(res.code, 200);
});
test("accepts the exact signature algorithm the gateway uses (HMAC-SHA256 hex over the raw body)", () => {
  const b = Buffer.from('{"x":1}'); // gateway: crypto.createHmac("sha256", secret).update(body).digest("hex")
  assert.equal(verifyFabricPay(b, crypto.createHmac("sha256", SECRET).update(b).digest("hex"), SECRET), true);
  assert.equal(verifyFabricPay(b, "bad", SECRET), false);
});
