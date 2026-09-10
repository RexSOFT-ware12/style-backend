/**
 * Static knowledge base for "Fibo Live Chat" — the site-wide assistant.
 * This is hand-curated from the storefront's actual pages/policies so the
 * assistant can answer questions about how the whole application works,
 * not just about one product. Keep this in sync when copy on those pages
 * changes materially.
 */
const SITE_KNOWLEDGE = `
FABRICNOW — WHAT THE BUSINESS IS
FabricNow sells studio-quality fabric assets and ready-to-use CLO3D garment
files. Every product is a DIGITAL download (a .zip containing a CLO3D
.zprj project file plus its fabric, pattern, and texture assets) — there is
no physical shipping, no international shipping restrictions, and access is
instant after payment.

KEY PAGES & WHAT THEY'RE FOR
- / (Home) — featured products and entry point to the catalog.
- /product/[id] — a single product's detail page (images, fabric/color/
  style/price, description, reviews, and the "Fibo" per-product fabric
  assistant chat widget).
- /cart — shopping cart before checkout.
- /checkout and /checkout/success — payment (via Stripe) and order
  confirmation; downloads unlock immediately on the success page.
- /signin, /signup — account authentication.
- /account/purchases (My Purchases) — every past order with a Download
  button next to each item; the way to re-download anything already bought.
- /wishlist — saved products.
- /blog — articles.
- /help — Help Center with FAQs grouped under Orders & Downloads, Files &
  Compatibility, and Account & Billing.
- /contact — contact form, contact details, and FAQs.
- /about — company background.
- /returns — Returns & Exchanges policy.
- /licensing — Download & Licensing terms (what you can do with purchased
  files, including commercial use terms).
- /terms, /privacy, /cookies, /accessibility — legal pages.
- /careers, /press — company/careers and press info.

ORDERS & DOWNLOADS
- There's no shipping — a purchase unlocks the download instantly on the
  checkout success page, and it stays available afterward.
- To re-download something already bought, go to My Purchases (under the
  account menu) — every paid order is listed there with its own Download
  button.
- If a download fails partway through, try the Download button again from
  My Purchases — it starts a fresh download rather than resuming a broken
  one. If it keeps failing, contact support.
- A purchased file can be re-downloaded as many times as needed, on any of
  the customer's own devices.

FILES & COMPATIBILITY
- Each download is a single .zip containing the CLO3D .zprj project file
  plus its fabric, pattern, and texture assets — it opens directly in
  CLO3D, no extra setup.
- Files are built for CLO3D; check a product's page for any version notes
  if the customer is on an older release.
- Commercial use is allowed within the terms of FabricNow's license — see
  the Download & Licensing page for exactly what's permitted.

ACCOUNT & BILLING
- Password reset: use "Forgot password" on the sign-in page.
- Payment methods: all major credit and debit cards, processed securely
  through Stripe.
- Refund policy: because each purchase unlocks a digital file immediately,
  FabricNow does not offer refunds once a download has started. Exceptions
  (see Returns & Exchanges) are made when: a file won't open or is
  corrupted (support will provide a working copy), the wrong product was
  received (support will sort out the correct file), or a customer was
  charged twice for the same order (the duplicate charge is refunded).
  These exceptions require contacting support with the order number.

CATALOG
Products are organized by category, style, fabric, and color; each has a
price, description, images, and customer reviews. The live list of
categories/styles/fabrics currently offered is provided separately below
when available — use that instead of guessing.

CONTACT
- Email: info@fabricnow.com (general) or support@tonasel.com (support).
- Phone: +1 (201) 909-4567, Mon–Fri from 8am to 5pm.
- Office: 3308 De Reimer Ave, Bronx, NY 10475.
- Working hours: Monday–Friday 9am–6pm, Saturday 10am–4pm, Sunday closed.
- Customers can also reach out via the contact form on /contact.
`.trim();

module.exports = { SITE_KNOWLEDGE };
