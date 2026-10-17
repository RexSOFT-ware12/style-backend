// POST /api/store-export/push — sends products to a merchant's Shopify or WooCommerce store.
// Credentials are used for this request only and are never stored or logged.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireCompany, requirePermission } = require('../middleware/company');
const { createRateLimiter } = require('../middleware/rateLimit');
const { safeFetch } = require('../lib/safeFetch');
const { SHOPIFY_VERSION, SHOPIFY_MUTATION, shopifyInput, wooBody, wooVariations } = require('../lib/storePush');

const router = express.Router();
router.use(requireAuth, requireCompany);
const limiter = createRateLimiter({ windowMs: 60_000, max: 6, message: 'You are pushing to stores quickly. Please wait a minute and try again.' });
const MAX_PRODUCTS = 25; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 300);

async function pushShopify(cred, p) {
  const res = await safeFetch(`https://${cred.shop}/admin/api/${SHOPIFY_VERSION}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': cred.token },
    body: JSON.stringify({ query: SHOPIFY_MUTATION, variables: { input: shopifyInput(p) } }),
  });
  const text = await res.text(); let json = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) throw new Error('Shopify rejected the access token. Check it has the write_products permission.');
  if (!res.ok) throw new Error(`Shopify answered ${res.status}. ${short(json.errors?.[0]?.message || json.errors || text)}`);
  if (json.errors?.length) throw new Error(short(json.errors.map((e) => e.message).join('; ')));
  const out = json.data?.productSet;
  if (out?.userErrors?.length) throw new Error(short(out.userErrors.map((e) => `${(e.field || []).join('.')} ${e.message}`.trim()).join('; ')));
  const gid = out?.product?.id || ''; const id = gid.split('/').pop();
  return { id, url: id ? `https://${cred.shop}/admin/products/${id}` : '' };
}

async function pushWoo(cred, p) {
  const base = cred.url.replace(/\/+$/, ''); const auth = `Basic ${Buffer.from(`${cred.key}:${cred.secret}`).toString('base64')}`;
  const call = async (path, body) => {
    const res = await safeFetch(`${base}/wp-json/wc/v3${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body) });
    const text = await res.text(); let json = {}; try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (res.status === 401 || res.status === 403) throw new Error('WooCommerce rejected the keys. Check they have Read/Write permission.');
    if (!res.ok) throw new Error(`WooCommerce answered ${res.status}. ${short(json.message || text)}`);
    return json;
  };
  const prod = await call('/products', wooBody(p));
  if (prod.type === 'variable') await call(`/products/${prod.id}/variations/batch`, wooVariations(p));
  return { id: String(prod.id), url: `${base}/wp-admin/post.php?post=${prod.id}&action=edit` };
}

router.post('/push', requirePermission('products:write'), limiter, async (req, res, next) => {
  try {
    const { platform, credentials: c = {}, products } = req.body || {};
    if (!Array.isArray(products) || !products.length) return res.status(400).json({ error: 'Choose at least one product to push.' });
    if (products.length > MAX_PRODUCTS) return res.status(400).json({ error: `Push up to ${MAX_PRODUCTS} products at a time.` });
    let push; let cred;
    if (platform === 'shopify') {
      const shop = String(c.shop || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return res.status(400).json({ error: 'Enter your store address as yourstore.myshopify.com.' });
      if (!String(c.token || '').trim()) return res.status(400).json({ error: 'Enter the Admin API access token.' });
      cred = { shop, token: String(c.token).trim() }; push = pushShopify;
    } else if (platform === 'woocommerce') {
      if (!String(c.url || '').trim() || !String(c.key || '').trim() || !String(c.secret || '').trim()) return res.status(400).json({ error: 'Enter the store URL, consumer key and consumer secret.' });
      cred = { url: String(c.url).trim(), key: String(c.key).trim(), secret: String(c.secret).trim() }; push = pushWoo;
    } else return res.status(400).json({ error: 'Pushing is available for Shopify and WooCommerce.' });

    const results = [];
    for (const p of products) {
      try { results.push({ name: p.name, ok: true, ...(await push(cred, p)) }); }
      catch (e) { results.push({ name: p.name, ok: false, error: e.message }); if (/rejected the (access token|keys)|could not be found|not allowed|must start with/.test(e.message)) break; }
      await wait(350); // stay under store rate limits
    }
    res.json({ results });
  } catch (e) { next(e); }
});

module.exports = router;
