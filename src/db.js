/**
 * Tiny file-backed JSON "database".
 *
 * This project intentionally avoids a native DB engine (Postgres/MySQL/SQLite)
 * so it runs anywhere with zero setup — perfect for local dev while you wire
 * the dashboard + storefront together. Swapping this for a real DB later only
 * means rewriting the functions in this file; every route just calls these.
 *
 * Data is persisted to src/data/db.json and re-read/written on every request.
 * That's plenty fast for an admin dashboard + storefront at this scale, and
 * it means the dashboard and the storefront are ALWAYS looking at the same
 * file — which is exactly the "both stay in sync" behavior you asked for.
 */
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "db.json");

function defaultData() {
  return {
    products: [],
    users: [],
    orders: [],
  };
}

function ensureFile() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultData(), null, 2));
  }
}

function readDb() {
  ensureFile();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("db.json was corrupted, resetting to defaults:", err);
    const fresh = defaultData();
    writeDb(fresh);
    return fresh;
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { readDb, writeDb, DB_PATH };
