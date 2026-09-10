# Product image normalization (HD + consistent size)

## What changed
- **`package.json`** — added the `sharp` dependency.
- **`src/middleware/processImage.js`** (new) — after a product image is
  uploaded, resizes/crops it to a fixed 1600x1600 square and re-encodes it
  as a high-quality JPEG (quality 90). This runs no matter what the seller
  uploads: any resolution, orientation, or format (jpg/png/webp/etc.) — the
  file saved to disk (and served to the storefront) is always the same
  square size and quality.
- **`src/routes/products.js`** — `processProductImage` is now run right
  after `productUpload` on both `POST /api/products` and
  `PUT /api/products/:id`, before the file's name is turned into the public
  image URL. Nothing else in the request flow changed.

## Install
From your `style-backend` project root, drop these three files into place
(overwriting the existing `products.js` and `package.json`, adding the new
`processImage.js`), then:

```bash
npm install
```

That pulls in `sharp` (it ships prebuilt binaries, no extra system
dependencies needed on Linux/Mac/Windows).

## How it behaves
- Upload a huge 6000x4000 photo → cropped centered to 1600x1600, quality 90 JPEG.
- Upload a tiny 200x150 screenshot → upscaled to 1600x1600 (still consistent
  size, though a very small source image will look softer — garbage in,
  garbage out, but at least it won't break the grid layout).
- Upload a portrait or landscape photo → center-cropped to a square, same
  as the others.
- If processing fails for any reason (corrupt file, unsupported format),
  it falls back to keeping the original upload rather than blocking the
  seller from saving the product.

## Adjusting it
Both knobs live at the top of `processImage.js`:

```js
const PRODUCT_IMAGE_SIZE = 1600; // output width/height in px
const JPEG_QUALITY = 90;         // 1-100
```

If you'd rather pad instead of crop (e.g. to always show the whole
garment even on odd aspect ratios) swap `fit: "cover"` for
`fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 }` in the
`.resize()` call — that letterboxes onto a white square instead of cropping.

## Catalog categories, styles and fabrics

Starter category/style/fabric values are stored in MongoDB rather than hardcoded in the dashboard. Seed them once after deploying the updated backend:

```bash
npm run seed-taxonomies
```

Admins can manage them at the dashboard's **Catalog Options** page. Active values automatically populate the Add Product dropdowns and storefront filters. Renaming a value updates existing products; hiding a value keeps it on old products but removes it from new-product selection.

## Customer reviews

Customers must be signed in and have a paid order containing the digital product before they can submit a review. Each customer can submit one review per product. Reviews are stored with the reviewer's user ID and are marked as verified purchases.
