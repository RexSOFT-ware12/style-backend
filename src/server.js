require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

const productsRouter = require("./routes/products");
const authRouter = require("./routes/auth");
const statsRouter = require("./routes/stats");
const ordersRouter = require("./routes/orders");
const { readDb } = require("./db");

function resolveUploadDir() {
  const candidates = [
    path.resolve(process.cwd(), "uploads"),
    path.resolve(__dirname, "..", "uploads"),
    path.resolve("/tmp", "fabricnow-uploads"),
  ];

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  throw new Error("Could not create a writable upload directory.");
}

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors()); // allow the Next.js storefront (3000) and the Vite dashboard (5173) to call this API
app.use(morgan("dev"));

// Stripe webhook needs the raw, unparsed request body to verify its
// signature — it must be registered BEFORE express.json() below.
app.use("/api/orders/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded product images when using local filesystem uploads.
// If this app is configured for Google Cloud Storage, image URLs are generated
// directly to the bucket path instead of serving files from /uploads.
const UPLOAD_DIR = resolveUploadDir();
if (!process.env.STORAGE_BUCKET && !process.env.GCS_BUCKET_NAME) {
  app.use("/uploads", express.static(UPLOAD_DIR));
}

// Auto-seed on first run so the app isn't empty out of the box
const db = readDb();
if (db.products.length === 0) {
  console.log("No products found — seeding starter catalog...");
  require("./data/seed")();
}

app.get("/", (req, res) => {
  res.json({
    name: "FabricNow API",
    status: "ok",
    endpoints: [
      "GET    /api/products",
      "GET    /api/products/meta",
      "GET    /api/products/:id",
      "POST   /api/products        (auth required)",
      "PUT    /api/products/:id    (auth required)",
      "PATCH  /api/products/:id/stock (auth required)",
      "DELETE /api/products/:id    (auth required)",
      "POST   /api/auth/signup",
      "POST   /api/auth/signin",
      "GET    /api/auth/me         (auth required)",
      "GET    /api/stats",
      "POST   /api/orders/checkout           (auth required) — creates a Stripe Checkout Session",
      "POST   /api/orders/webhook            (Stripe only)",
      "GET    /api/orders/me                 (auth required) — order/purchase history",
      "GET    /api/orders/:orderId/download/:productId (auth required) — gated file download",
    ],
  });
});

app.use("/api/products", productsRouter);
app.use("/api/auth", authRouter);
app.use("/api/stats", statsRouter);
app.use("/api/orders", ordersRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler (e.g. multer file errors)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

app.listen(PORT, () => {
  console.log(`FabricNow API running on http://localhost:${PORT}`);
});
