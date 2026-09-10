const { Storage } = require("@google-cloud/storage");

let storage = null;
let bucket = null;

function bucketName() {
  return process.env.STORAGE_BUCKET || process.env.GCS_BUCKET_NAME || null;
}

function cleanCredentialValue(value) {
  let v = String(value || "").trim();
  // Defensive cleanup for values pasted straight out of a downloaded
  // service-account JSON file (trailing commas, stray quote characters
  // left over from "key": "value", -> key=value editing). Handles both a
  // real trailing quote (`"`) and an escaped one (`\"`) at the end.
  v = v.replace(/,\s*$/, "");
  v = v.replace(/\\"\s*$/, "").replace(/"\s*$/, "");
  v = v.replace(/^\\"\s*/, "").replace(/^"\s*/, "");
  // Now strip a single remaining pair of matching outer quotes, if any.
  v = v.replace(/^(["'])(.*)\1$/s, "$2");
  return v.trim();
}

function getBucket() {
  const name = bucketName();
  if (!name) return null; // GCS not configured — callers fall back to local /uploads

  if (!storage) {
    const projectId = cleanCredentialValue(process.env.project_id || process.env.PROJECT_ID);
    const client_email = cleanCredentialValue(process.env.client_email);
    const private_key = cleanCredentialValue(process.env.private_key);
    // If a service-account key is in env, use it explicitly. Otherwise fall
    // back to Application Default Credentials (works automatically when
    // running on App Engine / Cloud Run / GCE with an attached service
    // account — no keys needed).
    storage =
      client_email && private_key
        ? new Storage({
            projectId,
            credentials: {
              client_email,
              // .env files can't hold real newlines in a value, so the key is
              // stored with literal "\n" and needs to be restored here.
              private_key: private_key.replace(/\\n/g, "\n"),
            },
          })
        : new Storage({ projectId });
  }

  if (!bucket) bucket = storage.bucket(name);
  return bucket;
}

/**
 * Uploads a local file to the configured private GCS bucket and returns its
 * internal object URI — or returns null if no bucket is configured, so the caller can fall
 * back to serving the file locally via /uploads instead.
 *
 * This is the piece that was missing before: the code was building
 * https://storage.googleapis.com/... URLs for files that were only ever
 * saved to local disk, so every uploaded image 404'd on the storefront.
 */
async function uploadToBucket(localPath, destFilename) {
  const b = getBucket();
  if (!b) return null;

  const folder = process.env.STORAGE_FOLDER || "bucket";
  const destination = `${folder}/${destFilename}`;

  await b.upload(localPath, {
    destination,
    metadata: { cacheControl: "private, max-age=3600" },
  });

  return `gs://${b.name}/${destination}`;
}

/**
 * Generates a v4 signed URL the browser can PUT a file to directly, bypassing
 * this server entirely. This is how large digital-file uploads (up to
 * ~1000MB) get around App Engine Standard's hard 32MB request-size limit —
 * the file never passes through an Express request handler at all.
 *
 * Requires the runtime's service account to have `iam.serviceAccounts.signBlob`
 * on itself (the "Service Account Token Creator" role) when running on
 * Application Default Credentials with no explicit private_key in env —
 * that's what @google-cloud/storage uses under the hood to sign without a
 * local key file.
 */
async function createResumableUploadSession(destFilename, contentType, totalSize, origin) {
  const b = getBucket();
  if (!b) throw new Error("GCS bucket is not configured (set STORAGE_BUCKET)." );

  const folder = process.env.STORAGE_FOLDER || "bucket";
  const destination = `${folder}/${destFilename}`;
  const file = b.file(destination);

  // This creates a GCS resumable-upload session instead of a V4 signed URL.
  // The browser receives an opaque session URI and uploads the ZIP in chunks.
  // There is no 2-hour signed-URL expiry involved, and the upload itself never
  // passes through App Engine's 32MB request limit.
  const [sessionUri] = await file.createResumableUpload({
    metadata: {
      contentType: contentType || "application/zip",
      metadata: {
        uploadSize: String(totalSize || 0),
      },
    },
    // Cloud Storage binds CORS behavior for the resumable session to the
    // Origin used when the session is created. The browser may be running on
    // Vite (5173), localhost:3000, 127.0.0.1, or the deployed dashboard, so
    // use the actual request Origin supplied by the authenticated dashboard.
    origin: origin || process.env.DASHBOARD_ORIGIN || undefined,
  });

  return { sessionUri, objectName: destination };
}

async function downloadObject(objectName, res) {
  const b = getBucket();
  if (!b) return false;

  const file = b.file(objectName);

  // A single getMetadata() call replaces the old exists() + getMetadata()
  // pair — that was two sequential round trips to GCS before a single byte
  // could be sent. On a cold App Engine instance those two extra round
  // trips were often enough, on their own, to blow past Next.js's ~7s
  // image-optimizer timeout ("upstream image response timed out").
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (err) {
    if (err.code === 404) return false;
    throw err;
  }

  if (metadata.contentType) res.type(metadata.contentType);
  // These are public-facing marketing photos, not the gated digital file
  // (that stays behind requireAuth + purchase checks in routes/orders.js).
  // Serving them as publicly cacheable lets any CDN/edge layer in front of
  // this app (and Next's own image-optimizer cache) reuse a successful
  // response instead of re-hitting this endpoint — and therefore GCS —
  // on every single request.
  res.set("Cache-Control", metadata.cacheControl || "public, max-age=31536000, immutable");
  file.createReadStream().on("error", (error) => res.destroy(error)).pipe(res);
  return true;
}

async function streamObject(objectName, res, downloadName) {
  const b = getBucket();
  if (!b) return false;

  const file = b.file(objectName);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (err) {
    if (err.code === 404) return false;
    throw err;
  }

  res.set("Content-Type", metadata.contentType || "application/zip");
  if (metadata.size) res.set("Content-Length", metadata.size);
  res.set("Content-Disposition", `attachment; filename="${downloadName.replace(/"/g, "")}"`);
  file.createReadStream().on("error", (error) => res.destroy(error)).pipe(res);
  return true;
}

module.exports = {
  uploadToBucket,
  downloadObject,
  streamObject,
  createResumableUploadSession,
  bucketConfigured: () => Boolean(bucketName()),
};