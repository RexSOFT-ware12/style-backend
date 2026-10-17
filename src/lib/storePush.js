// Builds the request bodies for pushing products to Shopify (GraphQL Admin API) and WooCommerce (REST v3).
const SHOPIFY_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
const num = (v) => { if (v === undefined || v === null || String(v).trim() === '') return null; const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) && n >= 0 ? n : null; };
const sizesOf = (p) => (Array.isArray(p.sizes) ? p.sizes.map((s) => String(s).trim()).filter(Boolean).slice(0, 30) : []);
const imagesOf = (p) => (Array.isArray(p.images) ? p.images.filter((u) => /^https:\/\//i.test(u)).slice(0, 10) : []);

function shopifyInput(p) {
  const sizes = sizesOf(p); const price = num(p.price); const sku = String(p.sku || '').trim();
  const priceStr = price === null ? '0.00' : price.toFixed(2);
  const input = {
    title: String(p.name || 'Untitled').slice(0, 255), descriptionHtml: String(p.descriptionHtml || ''), vendor: String(p.vendor || ''), productType: String(p.type || ''),
    tags: Array.isArray(p.tags) ? p.tags.map(String).filter(Boolean).slice(0, 50) : [], status: p.publish ? 'ACTIVE' : 'DRAFT',
    productOptions: sizes.length ? [{ name: 'Size', position: 1, values: sizes.map((name) => ({ name })) }] : [{ name: 'Title', position: 1, values: [{ name: 'Default Title' }] }],
    variants: sizes.length
      ? sizes.map((s) => ({ optionValues: [{ optionName: 'Size', name: s }], price: priceStr, ...(sku ? { sku: `${sku}-${s}` } : {}) }))
      : [{ optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: priceStr, ...(sku ? { sku } : {}) }],
  };
  const imgs = imagesOf(p);
  if (imgs.length) input.files = imgs.map((originalSource) => ({ originalSource, contentType: 'IMAGE', alt: input.title }));
  return input;
}

const SHOPIFY_MUTATION = `mutation FabricNowProductSet($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) { product { id handle } userErrors { field message code } }
}`;

function wooBody(p) {
  const sizes = sizesOf(p); const price = num(p.price); const stock = num(p.stock);
  const body = {
    name: String(p.name || 'Untitled'), type: sizes.length ? 'variable' : 'simple', status: p.publish ? 'publish' : 'draft', sku: String(p.sku || ''),
    description: String(p.descriptionHtml || ''), images: imagesOf(p).map((src) => ({ src })),
  };
  if (!sizes.length && price !== null) body.regular_price = price.toFixed(2);
  if (!sizes.length && stock !== null) { body.manage_stock = true; body.stock_quantity = Math.round(stock); }
  if (sizes.length) body.attributes = [{ name: 'Size', visible: true, variation: true, options: sizes }];
  return body;
}

function wooVariations(p) {
  const price = num(p.price); const stock = num(p.stock); const sku = String(p.sku || '').trim();
  return { create: sizesOf(p).map((s) => ({
    ...(price !== null ? { regular_price: price.toFixed(2) } : {}), ...(sku ? { sku: `${sku}-${s}` } : {}),
    attributes: [{ name: 'Size', option: s }], ...(stock !== null ? { manage_stock: true, stock_quantity: Math.round(stock) } : {}),
  })) };
}

module.exports = { SHOPIFY_VERSION, SHOPIFY_MUTATION, shopifyInput, wooBody, wooVariations };
