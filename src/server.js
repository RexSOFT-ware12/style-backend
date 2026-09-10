require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

const { connectDB } = require("./db");
const productsRouter = require("./routes/products");
const authRouter = require("./routes/auth");
const statsRouter = require("./routes/stats");
const ordersRouter = require("./routes/orders");
const assistantRouter = require("./routes/assistant");
const taxonomiesRouter = require("./routes/taxonomies");
const poseToolRouter = require("./routes/poseTool");
const billingRouter = require("./routes/billing");
const svgCustomizeRouter = require("./routes/svgCustomize");

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

// App Engine (and most PaaS front-ends) terminate TLS at the edge and proxy
// to this app over plain HTTP, setting X-Forwarded-Proto instead. Without
// this, req.protocol always reports "http" — even for real HTTPS requests —
// which corrupted every generated image URL (toPublicUrl() in
// routes/products.js builds URLs from req.protocol).
app.set("trust proxy", true);

app.use(cors()); // allow the Next.js storefront (3000) and the Vite dashboard (5173) to call this API
app.use(morgan("dev"));

// Stripe webhook needs the raw, unparsed request body to verify its
// signature — it must be registered BEFORE express.json() below.
app.use("/api/orders/webhook", express.raw({ type: "application/json" }));
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded product images when using local filesystem uploads.
// If this app is configured for Google Cloud Storage, image URLs are generated
// directly to the bucket path instead of serving files from /uploads.
const UPLOAD_DIR = resolveUploadDir();
if (!process.env.STORAGE_BUCKET && !process.env.GCS_BUCKET_NAME) {
  app.use("/uploads", express.static(UPLOAD_DIR));
}

app.get("/", (req, res) => {
  res.json({
    name: "FabricNow API",
    status: "ok",
    endpoints: [
      "GET    /api/products",
      "GET    /api/products/meta",
      "POST   /api/products/design-patterns/preview  — public, rate-limited: try the PNG->SVG tracer live",
      "GET    /api/products/:id",
      "POST   /api/products/:id/reviews     (auth + paid purchase required)",
      "GET    /api/taxonomies",
      "GET    /api/taxonomies/manage       (auth required)",
      "POST   /api/taxonomies              (auth required)",
      "PUT    /api/taxonomies/:id           (auth required)",
      "DELETE /api/taxonomies/:id           (auth required)",
      "POST   /api/products        (auth required)",
      "PUT    /api/products/:id    (auth required)",
      "DELETE /api/products/:id    (auth required)",
      "POST   /api/auth/signup",
      "POST   /api/auth/signin",
      "GET    /api/auth/me         (auth required)",
      "GET    /api/stats",
      "POST   /api/orders/checkout           (auth required) — creates a Stripe Checkout Session",
      "POST   /api/orders/webhook            (Stripe only)",
      "GET    /api/orders/me                 (auth required) — order/purchase history",
      "GET    /api/orders/:orderId/download/:productId (auth required) — gated file download",
      "POST   /api/assistant/ask             — Fibo, the product-page fabric assistant",
      "POST   /api/assistant/chat            — Fibo Live Chat, the site-wide assistant",
      "POST   /api/assistant/onboarding      (auth required) — first-signup Welcome page picks",
      "POST   /api/pose-tool/process         (auth required) — photo -> CLO3D pose notes + turnaround refs",
      "GET    /api/billing/status             (auth required) — trial/subscription status",
      "POST   /api/billing/checkout           (auth required) — Stripe Checkout for consumer premium plan",
      "POST   /api/billing/portal             (auth required) — Stripe Billing Portal (manage/cancel)",
      "GET    /api/billing/api-status          (auth required) — API tier/quota/usage + key list",
      "POST   /api/billing/api-checkout        (auth required) — Stripe Checkout for API Starter/Growth",
      "POST   /api/billing/api-keys            (auth required) — generate a new API key",
      "GET    /api/billing/api-keys            (auth required) — list API keys (no secrets)",
      "DELETE /api/billing/api-keys/:id        (auth required) — revoke an API key",
      "GET    /api/billing/api-key-status      (x-api-key header) — used by garment-service",
      "POST   /api/billing/api-usage           (x-api-key header) — used by garment-service",
      "POST   /api/billing/webhook            (Stripe only)",
      "POST   /api/svg-customize/process      (auth + premium required) — customizable PNG->SVG trace",
    ],
  });
});

app.use("/api/products", productsRouter);
app.use("/api/taxonomies", taxonomiesRouter);
app.use("/api/auth", authRouter);
app.use("/api/stats", statsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/pose-tool", poseToolRouter);
app.use("/api/billing", billingRouter);
app.use("/api/svg-customize", svgCustomizeRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler (e.g. multer file errors, Mongoose validation errors)
app.use((err, req, res, next) => {
  // Always log the real error server-side, regardless of what we send back.
  console.error(err);

  const status = err.status || 500;

  // Below 500 (validation errors, "not found", multer rejections, etc.) are
  // expected, caller-facing errors — safe and useful to return verbatim.
  // 500s are unexpected failures (DB errors, bugs, etc.) that may carry
  // internal details (stack traces, connection strings, query info) in
  // err.message, so those get a generic message instead of a leak.
  if (status >= 500) {
    return res.status(status).json({ error: "Something went wrong on our end. Please try again." });
  }

  res.status(status).json({ error: err.message || "Request error" });
});

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`FabricNow API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });
