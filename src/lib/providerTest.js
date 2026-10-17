// "Test key" buttons on the dashboard: one cheap, read-only call per provider.
// Never returns or logs the key itself.
const TESTS = {
  OPENAI_API_KEY: (k) => ({ url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${k}` } }),
  ANTHROPIC_API_KEY: (k) => ({
    url: "https://api.anthropic.com/v1/models?limit=1",
    headers: { "x-api-key": k, "anthropic-version": "2023-06-01" },
  }),
  GEMINI_API_KEY: (k) => ({
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headers: { "x-goog-api-key": k },
  }),
  HF_TOKEN: (k) => ({ url: "https://huggingface.co/api/whoami-v2", headers: { Authorization: `Bearer ${k}` } }),
  UNSPLASH_ACCESS_KEY: (k) => ({
    url: "https://api.unsplash.com/photos?per_page=1",
    headers: { Authorization: `Client-ID ${k}`, "Accept-Version": "v1" },
  }),
  PEXELS_API_KEY: (k) => ({ url: "https://api.pexels.com/v1/search?query=fabric&per_page=1", headers: { Authorization: k } }),
};

function canTest(name) {
  return Object.prototype.hasOwnProperty.call(TESTS, name);
}

async function testProviderKey(name, key) {
  if (!canTest(name)) return { ok: false, message: "No automatic test for this setting." };
  if (!key) return { ok: false, message: "No key is set." };
  const { url, headers } = TESTS[name](key);
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (r.ok) return { ok: true, message: "Key works." };
    if (r.status === 401 || r.status === 403) return { ok: false, message: "The provider rejected this key (invalid or no permission)." };
    if (r.status === 429) return { ok: true, message: "Key is valid (provider is rate-limiting right now)." };
    return { ok: false, message: `Provider answered with HTTP ${r.status}.` };
  } catch (err) {
    return { ok: false, message: "Couldn't reach the provider (network or timeout)." };
  }
}

module.exports = { testProviderKey, canTest };
