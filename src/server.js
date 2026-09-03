require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

const productsRouter = require("./routes/products");
const authRouter = require("./routes/auth");
const statsRouter = require("./routes/stats");
const { readDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors()); // allow the Next.js storefront (3000) and the Vite dashboard (5173) to call this API
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded product images
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

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
    ],
  });
});

app.use("/api/products", productsRouter);
app.use("/api/auth", authRouter);
app.use("/api/stats", statsRouter);

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
