# FabricNow API

The shared backend for **both** the FabricNow storefront (Next.js, port 3000)
and the FabricNow Admin Dashboard (Vite, port 5173). Add, edit, or delete a
product from the dashboard and it shows up on the storefront instantly (and
vice‑versa for reads) — both apps read the same `/api/products` endpoint,
so nothing goes out of sync anymore.

## 1. Install & run

```bash
cd backend
npm install
npm run seed     # one-time: creates src/data/db.json with 10 starter products
npm run dev       # http://localhost:4000  (auto-restarts on file changes)
# or: npm start
```

No database server to install — data is persisted to `src/data/db.json`
(plain JSON file). Swap `src/db.js` for a real database later without
touching any route files.

Uploaded product images are written to `backend/uploads/` and served at
`http://localhost:4000/uploads/<file>`.

## 2. Environment variables (optional)

Create `backend/.env`:

```
PORT=4000
JWT_SECRET=replace-with-a-long-random-string
```

## 3. API reference

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/products` | – | List products. Query: `search, category, style, fabric, brand, minPrice, maxPrice, sort, page, limit` |
| GET | `/api/products/meta` | – | Distinct `categories`, `styles`, `fabrics`, `brands` (for filter dropdowns) |
| GET | `/api/products/:id` | – | Single product |
| POST | `/api/products` | ✅ | Create product. `multipart/form-data` (field `image` for file upload) or JSON body |
| PUT | `/api/products/:id` | ✅ | Update product |
| PATCH | `/api/products/:id/stock` | ✅ | Body `{ "stock": 40 }` or `{ "delta": -3 }` |
| DELETE | `/api/products/:id` | ✅ | Delete product |
| POST | `/api/auth/signup` | – | `{ name, email, password }` → `{ token, user }` |
| POST | `/api/auth/signin` | – | `{ email, password }` → `{ token, user }` |
| GET | `/api/auth/me` | ✅ | Verify a token |
| GET | `/api/stats` | – | Dashboard summary cards: totals, inventory value, low‑stock items |

Send `Authorization: Bearer <token>` on protected routes (returned from
`/api/auth/signup` or `/api/auth/signin`).

### Product shape

```json
{
  "id": "6FPGUunfWf",
  "name": "AirFlex Runner",
  "sku": "FN-SNK-001",
  "price": 89,
  "stock": 150,
  "category": "Footwear",
  "brand": "FabricNow",
  "style": "Athletic",
  "fabric": "Mesh",
  "color": "Black/White",
  "size": "M",
  "description": "...",
  "image": "https://...",
  "images": ["https://..."],
  "featured": false,
  "createdAt": "2026-09-03T00:15:45.215Z",
  "updatedAt": "2026-09-03T00:15:45.215Z"
}
```

`style` and `fabric` are free‑text (populated from the dashboard's "Add
Product" dropdowns) — the storefront reads them to show a Style/Fabric
badge on each product card and detail page.

## 4. CORS

CORS is fully open (`app.use(cors())`) so both `http://localhost:3000`
(storefront) and `http://localhost:5173` (dashboard, Vite default) can call
it directly during development. Lock this down to specific origins before
deploying to production.

## 5. Wiring it up

- **Dashboard**: set the API base URL in
  `style-dashboard/src/assets/js/api.js` (defaults to `http://localhost:4000/api`).
- **Storefront**: set `NEXT_PUBLIC_API_URL=http://localhost:4000/api` in
  `styles/.env.local` (defaults to the same value if unset).
