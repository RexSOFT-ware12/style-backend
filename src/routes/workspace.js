const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { requireAuth } = require("../middleware/auth");
const ApiSubscription = require("../models/ApiSubscription");
const { getApiEntitlement } = require("../lib/apiEntitlement");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Upload a JPG, PNG or WebP photo."), ok);
  },
});

const imageFilter = (_req, file, cb) => {
  const ok = /^image\/(png|jpe?g|webp)$/i.test(file.mimetype);
  cb(ok ? null : new Error("Upload a JPG, PNG or WebP photo."), ok);
};
// batch (up to 10 photos) and the listing writer (up to 4) send several files under one field name
const uploadMany = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10 }, fileFilter: imageFilter });

const configuredWorkerUrl = String(process.env.FABRIC_NOW_SERVICE_URL || "").trim();
const WORKER_URL = configuredWorkerUrl.replace(/\/$/, "");
const INTERNAL_SECRET = process.env.FABRIC_NOW_INTERNAL_SECRET || "";

function workerHeaders(req) {
  return {
    "x-fabric-internal-secret": INTERNAL_SECRET,
    "x-workspace-user-id": String(req.user.sub),
  };
}

// If the pattern engine (Python worker) is down or FABRIC_NOW_SERVICE_URL points nowhere, say so plainly
// instead of letting "fetch failed / ECONNREFUSED" bubble up as a generic 500.
async function workerFetch(req, path, options = {}) {
  const headers = { ...workerHeaders(req), ...(options.headers || {}) };
  if (!WORKER_URL) { const err = new Error("Pattern engine URL is not configured."); err.status = 503; err.publicMessage = "The FabricNow pattern engine is not configured for this environment. Please set FABRIC_NOW_SERVICE_URL."; err.code = "WORKER_NOT_CONFIGURED"; throw err; }
  try {
    return await fetch(`${WORKER_URL}${path}`, { ...options, headers });
  } catch (cause) {
    const err = new Error(`Pattern engine unreachable at ${WORKER_URL}: ${cause?.cause?.code || cause.message}`);
    err.status = 503;
    err.publicMessage = "The FabricNow pattern engine is offline right now. Please try again in a few minutes.";
    err.code = "WORKER_UNAVAILABLE";
    throw err;
  }
}


// The worker is FastAPI ({detail}) and stamps jobs with unix seconds; the workspace UI expects {error} and createdAt.
function normalizeJob(j) {
  if (!j || typeof j !== "object") return j;
  const { user_id, ...rest } = j;
  return { ...rest, kind: rest.kind || "pattern", createdAt: rest.created ? rest.created * 1000 : rest.createdAt };
}

async function relayJson(res, r, transform) {
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) {
    const d = data.detail;
    // FastAPI answers {"detail":"Not Found"} when the worker has no such endpoint (worker older than this API).
    if (r.status === 404 && d === "Not Found") {
      return res.status(501).json({ error: "This tool isn't available on the pattern engine yet. The worker needs to be updated.", code: "WORKER_ENDPOINT_MISSING" });
    }
    const msg = typeof d === "string" ? d : Array.isArray(d) ? "Check the form fields and try again." : data.error || "Request failed";
    return res.status(r.status).json({ error: msg });
  }
  return res.status(r.status).json(transform ? transform(data) : data);
}

// Same gate for every generator: an active API subscription.
async function requireApiAccess(req, res) {
  const apiSub = await ApiSubscription.findOne({ userId: req.user.sub });
  const entitlement = getApiEntitlement(apiSub);
  if (entitlement.hasAccess) return true;
  res.status(402).json({
    error: "An active API subscription is required to generate pattern assets.",
    code: "API_SUBSCRIPTION_REQUIRED",
  });
  return false;
}

function addFile(form, f) { form.append(f.fieldname, new Blob([f.buffer], { type: f.mimetype }), f.originalname); }

// Public liveness check used by the workspace topbar: is the pattern engine (Python worker) reachable?
router.get("/health", async (_req, res) => {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    if (!WORKER_URL) return res.json({ api: true, engine: false, configured: false });
    const r = await fetch(`${WORKER_URL}/api/health`, { signal: ctl.signal });
    res.json({ api: true, engine: r.ok, latencyMs: Date.now() - started });
  } catch {
    res.json({ api: true, engine: false });
  } finally { clearTimeout(timer); }
});

router.get("/config", (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    appName: process.env.WORKSPACE_APP_NAME || "FabricNow Workspace",
  });
});

router.get("/catalog", requireAuth, async (req, res, next) => {
  try { await relayJson(res, await workerFetch(req, "/api/catalog")); } catch (err) { next(err); }
});

router.get("/jobs", requireAuth, async (req, res, next) => {
  try {
    const r = await workerFetch(req, `/api/jobs${req.query.ids ? `?ids=${encodeURIComponent(req.query.ids)}` : ""}`);
    await relayJson(res, r, (list) => ({ jobs: (Array.isArray(list) ? list : []).map(normalizeJob) }));
  } catch (err) { next(err); }
});

router.get("/jobs/:id", requireAuth, async (req, res, next) => {
  try {
    const r = await workerFetch(req, `/api/jobs/${encodeURIComponent(req.params.id)}`);
    await relayJson(res, r, normalizeJob);
  } catch (err) { next(err); }
});

router.get("/jobs/:id/files/*", requireAuth, async (req, res, next) => {
  try {
    const relative = req.params[0] || "";
    const r = await workerFetch(req, `/api/jobs/${encodeURIComponent(req.params.id)}/files/${relative.split("/").map(encodeURIComponent).join("/")}`);
    if (!r.ok) return res.status(r.status).send(await r.text());
    const ct = r.headers.get("content-type");
    if (ct) res.set("Content-Type", ct);
    const cache = r.headers.get("cache-control");
    if (cache) res.set("Cache-Control", cache);
    const ab = await r.arrayBuffer();
    res.send(Buffer.from(ab));
  } catch (err) { next(err); }
});

router.get("/jobs/:id/export.zip", requireAuth, async (req, res, next) => {
  try {
    const r = await workerFetch(req, `/api/jobs/${encodeURIComponent(req.params.id)}/export.zip`);
    if (!r.ok) return res.status(r.status).send(await r.text());
    res.set("Content-Type", r.headers.get("content-type") || "application/zip");
    res.set("Content-Disposition", r.headers.get("content-disposition") || `attachment; filename="fabric-now-${req.params.id}.zip"`);
    const ab = await r.arrayBuffer();
    res.send(Buffer.from(ab));
  } catch (err) { next(err); }
});

router.delete("/jobs/:id", requireAuth, async (req, res, next) => {
  try {
    const r = await workerFetch(req, `/api/jobs/${encodeURIComponent(req.params.id)}`, { method: "DELETE" });
    res.status(r.status).send(await r.text());
  } catch (err) { next(err); }
});

router.post("/patterns", requireAuth, upload.fields([
  { name: "file", maxCount: 1 },
  { name: "swatch", maxCount: 1 },
]), async (req, res, next) => {
  try {
    if (!(await requireApiAccess(req, res))) return;
    if (!req.files?.file?.[0]) return res.status(400).json({ error: "A garment photo is required." });
    const form = new FormData();
    addFile(form, req.files.file[0]);
    if (req.files.swatch?.[0]) addFile(form, req.files.swatch[0]);
    for (const key of ["garment", "notes", "lining"]) {
      if (req.body[key] !== undefined) form.append(key, String(req.body[key]));
    }
    await relayJson(res, await workerFetch(req, "/api/jobs", { method: "POST", body: form }), normalizeJob);
  } catch (err) { next(err); }
});

// One pattern job per photo; every photo gets its own analysis and its own export.
router.post("/patterns/batch", requireAuth, uploadMany.array("files", 10), async (req, res, next) => {
  try {
    if (!(await requireApiAccess(req, res))) return;
    if (!req.files?.length) return res.status(400).json({ error: "Add at least one garment photo." });
    const form = new FormData();
    req.files.forEach((f) => addFile(form, f));
    for (const key of ["garment", "notes", "lining"]) {
      if (req.body[key] !== undefined) form.append(key, String(req.body[key]));
    }
    await relayJson(res, await workerFetch(req, "/api/jobs/batch", { method: "POST", body: form }),
      (d) => ({ jobs: (d.jobs || []).map(normalizeJob) }));
  } catch (err) { next(err); }
});

// Listing writer: synchronous, returns JSON for the seller to review.
router.post("/tools/listing", requireAuth, uploadMany.array("files", 4), async (req, res, next) => {
  try {
    if (!(await requireApiAccess(req, res))) return;
    if (!req.files?.length) return res.status(400).json({ error: "Add at least one product photo." });
    const form = new FormData();
    req.files.forEach((f) => addFile(form, f));
    if (req.body.notes !== undefined) form.append("notes", String(req.body.notes));
    await relayJson(res, await workerFetch(req, "/api/tools/listing", { method: "POST", body: form }));
  } catch (err) { next(err); }
});

const TOOL_KINDS = new Set(["print", "colorways", "fabric", "flats", "mockup", "asoebi"]);
const TOOL_FIELDS = ["prompt", "style", "count", "palettes", "garment", "notes", "model", "scenes", "styles", "input"];

router.post("/tools/:kind", requireAuth, upload.fields([{ name: "file", maxCount: 1 }]), async (req, res, next) => {
  try {
    if (!TOOL_KINDS.has(req.params.kind)) return res.status(404).json({ error: "Unknown tool." });
    if (!(await requireApiAccess(req, res))) return;
    const form = new FormData();
    if (req.files?.file?.[0]) addFile(form, req.files.file[0]);
    for (const key of TOOL_FIELDS) {
      if (req.body[key] !== undefined) form.append(key, String(req.body[key]));
    }
    await relayJson(res, await workerFetch(req, `/api/tools/${req.params.kind}`, { method: "POST", body: form }), normalizeJob);
  } catch (err) { next(err); }
});

// Size grading, seam allowance, marker layout, yardage and DXF for a finished pattern job.
router.post("/jobs/:id/grade", requireAuth, async (req, res, next) => {
  try {
    if (!(await requireApiAccess(req, res))) return;
    const form = new FormData();
    for (const key of ["sizes", "base_size", "base_length_cm", "fabric_width_cm", "seam_cm"]) {
      if (req.body?.[key] !== undefined && req.body[key] !== "") form.append(key, String(req.body[key]));
    }
    await relayJson(res, await workerFetch(req, `/api/jobs/${encodeURIComponent(req.params.id)}/grade`, { method: "POST", body: form }));
  } catch (err) { next(err); }
});

module.exports = router;
