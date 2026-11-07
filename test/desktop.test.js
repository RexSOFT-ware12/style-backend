// Run: node --test test/desktop.test.js   (no database / network: models, entitlement and fetch are stubbed)
const test = require("node:test"), assert = require("node:assert/strict"), path = require("path");
const stub = (rel, exports) => { const f = require.resolve(path.join(__dirname, "..", rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const GOOD = "fn_live_" + "a".repeat(43);
const { hashApiKey } = require("../src/lib/apiKeyCrypto");
let owner = { isBlocked: false, email: "a@b.co", name: "Ada" }, sub = { ok: true }, keyDoc;
const resetKey = () => { keyDoc = { id: "k1", userId: "u1", keyPrefix: "fn_live_aaaaaaaa", label: "desktop", revokedAt: null }; };
resetKey();
stub("src/models/ApiKey.js", { findOne: async (q) => (q.keyHash === hashApiKey(GOOD) ? keyDoc : null), updateOne: () => Promise.resolve() });
stub("src/models/User.js", { findById: () => ({ select: () => ({ lean: async () => owner }) }) });
stub("src/models/ApiSubscription.js", { findOne: async () => sub });
stub("src/lib/apiEntitlement.js", { getApiEntitlement: (s) => (s && s.ok ? { hasAccess: true, tier: "growth", status: "active", quota: 250, used: 5, remaining: 245, allowance: 250, currentPeriodEnd: null } : { hasAccess: false }) });

const { requireApiKey } = require("../src/middleware/requireApiKey");
const mkRes = () => { const r = { code: 200, json(b) { r.body = b; return r; }, status(c) { r.code = c; return r; }, set() {} }; return r; };
const run = async (headers) => { const req = { headers }, res = mkRes(); let nexted = false; await requireApiKey(req, res, () => { nexted = true; }); return { req, res, nexted }; };

test("missing key -> 401", async () => { const r = await run({}); assert.equal(r.res.code, 401); assert.equal(r.res.body.code, "API_KEY_MISSING"); });
test("garbage key -> 401", async () => { const r = await run({ "x-api-key": "hello" }); assert.equal(r.res.code, 401); });
test("unknown fn_live key -> 401", async () => { const r = await run({ "x-api-key": "fn_live_" + "b".repeat(43) }); assert.equal(r.res.code, 401); });
test("valid key via x-api-key passes and sets req.user", async () => {
  const r = await run({ "x-api-key": GOOD }); assert.ok(r.nexted); assert.equal(r.req.user.sub, "u1"); assert.equal(r.req.apiEntitlement.tier, "growth");
});
test("valid key via Bearer passes", async () => { assert.ok((await run({ authorization: "Bearer " + GOOD })).nexted); });
test("revoked key -> 401", async () => { keyDoc.revokedAt = new Date(); const r = await run({ "x-api-key": GOOD }); assert.equal(r.res.code, 401); resetKey(); });
test("blocked owner -> 403", async () => { owner = { ...owner, isBlocked: true }; const r = await run({ "x-api-key": GOOD }); assert.equal(r.res.code, 403); owner = { ...owner, isBlocked: false }; });
test("inactive subscription -> 402", async () => { sub = { ok: false }; const r = await run({ "x-api-key": GOOD }); assert.equal(r.res.code, 402); sub = { ok: true }; });

// ---- router (assistant) -------------------------------------------------
const router = require("../src/routes/desktop");
const handler = (method, p) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]).route.stack.map((s) => s.handle);
async function callRoute(method, p, req) {
  const res = mkRes(); const chain = handler(method, p); req.headers = req.headers || { "x-api-key": GOOD };
  for (const fn of chain) { let go = false; await fn(req, res, () => { go = true; }); if (!go) break; }
  return res;
}
test("whoami returns plan + clo policy, never the key", async () => {
  const res = await callRoute("get", "/whoami", {}); assert.equal(res.body.plan.tier, "growth"); assert.ok(res.body.cloPolicy.summary);
  assert.ok(!JSON.stringify(res.body).includes(GOOD));
});
test("assistant validates input", async () => {
  process.env.ANTHROPIC_API_KEY = "x";
  assert.equal((await callRoute("post", "/assistant", { body: { messages: [] } })).code, 400);
  assert.equal((await callRoute("post", "/assistant", { body: { messages: [{ role: "assistant", content: "hi" }] } })).code, 400);
  assert.equal((await callRoute("post", "/assistant", { body: { messages: [{ role: "user", content: "x".repeat(9000) }] } })).code, 400);
});
test("assistant forwards to Anthropic with the SERVER key and returns text only", async () => {
  process.env.ANTHROPIC_API_KEY = "server-secret"; let seen;
  global.fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ model: "m", content: [{ type: "text", text: "hello " }, { type: "tool_use" }, { type: "text", text: "world" }] }) }; };
  const res = await callRoute("post", "/assistant", { body: { system: "s", messages: [{ role: "user", content: "hi", extra: 1 }] } });
  assert.equal(res.body.reply, "hello world"); assert.equal(seen.init.headers["x-api-key"], "server-secret");
  assert.ok(!seen.init.body.includes(GOOD)); assert.ok(!seen.init.body.includes("extra"));
});
test("assistant upstream failure is hidden behind 502", async () => {
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { type: "x", message: "secret detail" } }) });
  const res = await callRoute("post", "/assistant", { body: { messages: [{ role: "user", content: "hi" }] } });
  assert.equal(res.code, 502); assert.ok(!JSON.stringify(res.body).includes("secret detail"));
});
test("assistant is rate limited per key", async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }] }) });
  let last; for (let i = 0; i < 12; i++) last = await callRoute("post", "/assistant", { body: { messages: [{ role: "user", content: "hi" }] } });
  assert.equal(last.code, 429);
});
