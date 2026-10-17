// Renders the public, shareable lookbook page. Plain HTML + inline CSS, no scripts.
const THEMES = {
  light: { bg: '#FBFAF8', card: '#FFFFFF', text: '#1D1A33', muted: '#6B6F80', line: '#E7E4EE', accent: '#E66239' },
  dark: { bg: '#12111D', card: '#1B1A2D', text: '#EDEFF7', muted: '#A4ABC2', line: '#2D2B45', accent: '#F08A63' },
  terracotta: { bg: '#2B1A15', card: '#38231C', text: '#FBEFE8', muted: '#D2B3A6', line: '#52352B', accent: '#F4A07C' },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(price, currency) {
  const n = Number(String(price).replace(/,/g, ''));
  if (!String(price).trim()) return '';
  return Number.isFinite(n) ? `${esc(currency)} ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : esc(price);
}

function renderLookbookPage(lb) {
  const t = THEMES[lb.theme] || THEMES.light;
  const cards = lb.items.map((it, i) => `
    <article>
      <img src="/l/${esc(lb.slug)}/img/${i}" alt="${esc(it.name)}" loading="${i < 4 ? 'eager' : 'lazy'}">
      <div><h2>${esc(it.name) || 'Untitled'}</h2>${it.price ? `<p class="price">${money(it.price, lb.currency)}</p>` : ''}${it.note ? `<p class="note">${esc(it.note)}</p>` : ''}</div>
    </article>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(lb.title)}${lb.brand ? ` · ${esc(lb.brand)}` : ''}</title>
<meta property="og:title" content="${esc(lb.title)}"><meta property="og:image" content="/l/${esc(lb.slug)}/img/0">
<style>
*{box-sizing:border-box}body{margin:0;background:${t.bg};color:${t.text};font-family:'Manrope',system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
header{max-width:1100px;margin:0 auto;padding:64px 24px 28px}
.brand{font-size:.85rem;font-weight:800;letter-spacing:.14em;color:${t.accent};margin:0 0 14px}
h1{font-size:clamp(2.2rem,6vw,4rem);line-height:1.04;letter-spacing:-.04em;margin:0 0 10px;max-width:14ch}
.sub{color:${t.muted};font-size:1.05rem;margin:0;max-width:52ch}
main{max-width:1100px;margin:0 auto;padding:12px 24px 72px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px}
article{background:${t.card};border:1px solid ${t.line};border-radius:22px;overflow:hidden}
article img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;background:${t.line}}
article div{padding:16px 18px 20px}h2{font-size:1.05rem;margin:0;letter-spacing:-.01em}
.price{margin:6px 0 0;font-weight:800;color:${t.accent}}.note{margin:8px 0 0;color:${t.muted};font-size:.9rem}
footer{max-width:1100px;margin:0 auto;padding:0 24px 40px;color:${t.muted};font-size:.8rem}
</style></head><body>
<header>${lb.brand ? `<p class="brand">${esc(lb.brand.toUpperCase())}</p>` : ''}<h1>${esc(lb.title)}</h1>${lb.subtitle ? `<p class="sub">${esc(lb.subtitle)}</p>` : ''}</header>
<main>${cards}</main>
<footer>Made with FabricNow</footer>
</body></html>`;
}

module.exports = { renderLookbookPage, THEMES };
