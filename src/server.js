require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { connectDB } = require("./db");
const { initSecrets } = require("./lib/secretsStore");
const adminRoutes = require("./routes/admin");
const productsRouter = require("./routes/products");
const authRouter = require("./routes/auth");
const statsRouter = require("./routes/stats");
const ordersRouter = require("./routes/orders");
const assistantRouter = require("./routes/assistant");
const taxonomiesRouter = require("./routes/taxonomies");
const poseToolRouter = require("./routes/poseTool");
const billingRouter = require("./routes/billing");
const svgCustomizeRouter = require("./routes/svgCustomize");
const convertRouter = require("./routes/convert");
const lookbookRoutes = require("./routes/lookbook");
const storeExportRouter = require("./routes/storeExport");
const workspaceRouter = require("./routes/workspace");
const workspaceSuiteRouter = require("./routes/workspaceSuite");
const companiesRouter = require("./routes/companies");
const inspirationLibraryRouter = require("./routes/inspirationLibrary");
const tailorToolsRouter = require("./routes/tailorTools");
const patternLibraryRouter = require("./routes/patternLibrary");
const bodyMeasurementsRouter = require("./routes/bodyMeasurements");
const contactRouter = require("./routes/contact");
const { verifyWebhookSignature } = require("./lib/paystack");
const { handleFabricPayEvent } = require("./routes/fabricPayEvents");

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

// Paystack uses one configured webhook URL for both subscriptions and orders.
// Verify the raw body before JSON middleware consumes it.
app.post("/api/paystack/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let valid;
  try {
    valid = verifyWebhookSignature(req.body, req.headers["x-paystack-signature"]);
  } catch (error) {
    console.error("Paystack webhook is not configured:", error.message);
    return res.status(500).send("Paystack webhook is not configured");
  }
  if (!valid) return res.status(400).send("Invalid Paystack webhook signature");

  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch (error) {
    console.error("Could not parse Paystack webhook:", error.message);
    return res.status(400).send("Invalid Paystack webhook payload");
  }

  try {
    await billingRouter.processPaystackEvent(event);
    await ordersRouter.processPaystackEvent(event);
    res.json({ received: true });
  } catch (error) {
    console.error("Failed to process Paystack webhook:", error.message);
    res.status(500).json({ error: "Paystack webhook processing failed." });
  }
});

// Central payment gateway (FabricNow Pay) forwards every Paystack event for this app here,
// signed with FABRIC_PAY_EVENT_SECRET. Must stay BEFORE express.json() (needs raw bytes).
// Once Paystack's dashboard webhook points at the gateway, the legacy /api/paystack/webhook
// above stops receiving traffic; keep it until the cutover is verified, then remove it.
app.post("/api/payments/paystack-events", express.raw({ type: "application/json" }), handleFabricPayEvent);

// Tailor Tools boards can carry a compressed photo underlay (stored in board.layers), so allow a bigger body on that route only.
app.use("/api/tailor-tools", express.json({ limit: "6mb" }));
// Fabric photos and design photos are sent as compressed data URLs.
app.use("/api/workspace-suite", express.json({ limit: "6mb" }));
app.use("/api/pattern-library", express.json({ limit: "6mb" }));
app.use("/api/lookbooks", express.json({ limit: "20mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
      "POST   /api/products/digital-file/upload-signature (auth required)",
      "POST   /api/auth/signup",
      "POST   /api/auth/signin",
      "GET    /api/auth/me         (auth required)",
      "GET    /api/stats",
      "POST   /api/contact                    — sends a message to FabricNow support",
      "POST   /api/orders/checkout           (auth required) — creates a Paystack checkout transaction",
      "GET    /api/orders/me                 (auth required) — order/purchase history",
      "GET    /api/orders/:orderId/download/:productId (auth required) — gated file download",
      "POST   /api/assistant/ask             — Fibo, the product-page fabric assistant",
      "POST   /api/assistant/chat            — Fibo Live Chat, the site-wide assistant",
      "POST   /api/assistant/workspace       — OpenAI-powered authenticated workspace copilot",
      "POST   /api/assistant/onboarding      (auth required) — first-signup Welcome page picks",
      "POST   /api/pose-tool/process         (auth required) — photo -> CLO3D pose notes + turnaround refs",
      "GET    /api/billing/status             (auth required) — trial/subscription status",
      "POST   /api/billing/checkout           (auth required) — Paystack checkout for consumer Premium",
      "POST   /api/billing/cancel             (auth required) — cancel Paystack renewal",
      "GET    /api/billing/api-status          (auth required) — API tier/quota/usage + key list",
      "POST   /api/billing/api-checkout        (auth required) — Paystack checkout for API Starter/Growth",
      "POST   /api/billing/api-keys            (auth required) — generate a new API key",
      "GET    /api/billing/api-keys            (auth required) — list API keys (no secrets)",
      "DELETE /api/billing/api-keys/:id        (auth required) — revoke an API key",
      "GET    /api/billing/api-key-status      (x-api-key header) — used by garment-service",
      "POST   /api/billing/api-usage           (x-api-key header) — used by garment-service",
      "POST   /api/paystack/webhook            (legacy: direct from Paystack; replaced by gateway below)",
      "POST   /api/payments/paystack-events    (central FabricNow Pay gateway, HMAC signed)",
      "GET    /api/inspiration-library        (auth required) — shared Pinterest inspiration library, visible to all companies",
      "GET    /api/inspiration-library/facets (auth required) — filter values (categories, regions, genders)",
      "GET    /api/admin/*                    (admin only) users, companies, block, manual API plans, credits, provider keys",
      "GET    /api/internal/provider-keys     (x-internal-secret) — provider keys for garment-service",
      "POST   /api/svg-customize/process      (auth + premium required) — customizable PNG->SVG trace",
    ],
  });
});

app.use("/api/products", productsRouter);
app.use("/api/taxonomies", taxonomiesRouter);
app.use("/api/auth", authRouter);
app.use("/api/stats", statsRouter);
app.use("/api/contact", contactRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/pose-tool", poseToolRouter);
app.use("/api/billing", billingRouter);
app.use("/api/svg-customize", svgCustomizeRouter);
app.use("/api/convert", convertRouter);
app.use("/api/lookbooks", lookbookRoutes.router);
app.use("/api/store-export", storeExportRouter);
app.use("/l", lookbookRoutes.pub);
app.use("/api/workspace", workspaceRouter);
app.use("/api/workspace-suite", workspaceSuiteRouter);
app.use("/api/companies", companiesRouter);
app.use("/api/inspiration-library", inspirationLibraryRouter);
app.use("/api/tailor-tools", tailorToolsRouter);
app.use("/api/pattern-library", patternLibraryRouter);
app.use("/api/body-measurements", bodyMeasurementsRouter);
app.use("/api/admin", adminRoutes.router);
app.use("/api/internal", adminRoutes.internalRouter);

// Workspace is a separate React application. This API only exposes /api/workspace routes.

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler (e.g. multer file errors, Mongoose validation errors)
app.use((err, req, res, next) => {
  // Always log the real error server-side, regardless of what we send back.
  console.error(err);

  const status = err.status || 500;

  // Errors that set publicMessage are safe to show to the user (e.g. "engine offline",
  // "assistant unavailable"); everything else at 5xx stays generic.
  if (err.publicMessage) {
    return res.status(status).json({ error: err.publicMessage, ...(err.code ? { code: err.code } : {}) });
  }

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
  .then(() => initSecrets()) // apply provider keys saved from the admin dashboard
  .then(() => {
    app.listen(PORT, () => {
      console.log(`FabricNow API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });
