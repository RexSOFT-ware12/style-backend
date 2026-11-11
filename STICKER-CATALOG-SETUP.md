# FabricNow sticker catalogue setup

The sticker shop contains 12 individual designs and 3 packs. The backend seed
script creates/updates matching `Product` records using each storefront sticker
slug as its SKU, and builds a private ZIP deliverable for every product.

## Seed the catalogue

From the `style-backend` directory:

```bash
npm install
npm run seed-stickers
```

The command requires the same environment configuration as the running API:

- `MONGODB_URI` (and optionally `MONGODB_DB_NAME`)
- Cloudinary credentials configured for FabricNow (`CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`)

The script renders a transparent PNG from each source SVG, packages both SVG
and PNG files, then uploads each ZIP as an authenticated Cloudinary raw asset.
Temporary ZIPs are built outside the project upload directory to avoid file
locking by sync tools such as OneDrive. The generated ZIPs are not public; the
existing authenticated purchase download endpoint delivers them only after a
matching order is marked paid.

The seed is safe to rerun: products are upserted by stable SKU. Re-running
refreshes the product deliverables and may leave older Cloudinary assets
unreferenced; remove those old assets from Cloudinary only after confirming
they are no longer attached to products.

## Checkout integration

The storefront cart sends the sticker SKU (for example,
`sticker-good-vibes`). `/api/orders/checkout` now resolves either a MongoDB
ObjectId (for existing products) or an exact SKU (for sticker products).
Prices and digital-file metadata always come from the database, not from the
client. Orders continue to store the resolved MongoDB product ID, so the
existing My Purchases and download authorization flow remains unchanged.

## Included pack contents

- Starter Pack: Good Vibes, Voltage, Retro Sunset, Flame Heart, Varsity Star,
  and Night Shift.
- Shorts Side-Print Pack: Retro Sunset, Wave Crest, Full Lap Checker, and
  Desert Pot.
- Full Library: all 12 individual sticker designs.
