const express = require("express");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Taxonomy = require("../models/Taxonomy");
const { requireAuth } = require("../middleware/auth");
const { productUpload, designPatternUpload, UPLOAD_DIR, DIGITAL_DIR } = require("../middleware/upload");
const { processProductImage } = require("../middleware/processImage");
const { downloadObject, createResumableUploadSession, bucketConfigured, uploadToBucket } = require("../lib/gcs");
const { generateReviews } = require("../lib/reviews");
const { convertPngToSvg } = require("../lib/svgConvert");
const { buildImageBundleZip } = require("../lib/zipBundle");
const { svgPreviewUpload } = require("../middleware/svgPreviewUpload");
const { createRateLimiter } = require("../middleware/rateLimit");
const { nanoid } = require("nanoid");
const fs = require("fs");
const os = require("os");
const path = require("path");

const router = express.Router();

// Design Patterns are regular Products under the hood (same price/name/
// description/digitalFile-zip/download flow as everything else) — they're
// just tagged with this category so they can be shown on their own
// storefront page and kept out of the main "All Products" grid by default.
const DESIGN_PATTERN_CATEGORY = "Design Patterns";

// Turns a product name into a safe filename base for the auto-generated
// bundle (e.g. "Houndstooth Check!" -> "houndstooth-check").
function safeFileBase(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Local disk is ephemeral on App Engine — a file written by one request can
// 404 on the very next one if it lands on a different instance, or once the
// instance recycles. Every other product image already avoids this by
// uploading to the configured GCS bucket (see middleware/processImage.js);
// these do the same thing for a generated Design Pattern SVG / auto-zip,
// falling back to local /uploads serving only when no bucket is configured.

// Publishes a locally-generated *image* file (the traced SVG) and returns
// the URL to store on the product's `image`/`heroImages` fields.
async function publishGeneratedImage(req, localPath, filename) {
  try {
    const publicUrl = await uploadToBucket(localPath, filename);
    if (publicUrl) {
      fs.unlink(localPath, () => {});
      return toPublicUrl(req, { publicUrl });
    }
  } catch (err) {
    console.error("GCS upload failed for design-pattern SVG, falling back to local file serving:", err.message);
  }
  return toPublicUrl(req, { publicUrl: null, filename });
}

// Publishes a locally-generated *digital file* (the auto-built zip) and
// returns a `digitalFile.fileName`/`storage` pair in the same shape
// `parseDigitalFileField` produces, so routes/orders.js's existing
// gcs/local download logic works on it unmodified.
async function publishGeneratedDigitalFile(localPath, filename) {
  try {
    const publicUrl = await uploadToBucket(localPath, `digital/${filename}`);
    if (publicUrl) {
      fs.unlink(localPath, () => {});
      const objectName = publicUrl.split("/").slice(3).join("/");
      return { fileName: objectName, storage: "gcs" };
    }
  } catch (err) {
    console.error("GCS upload failed for design-pattern zip, falling back to local file serving:", err.message);
  }
  return { fileName: filename, storage: "local" };
}

// Turns an uploaded multer file into the URL that will actually serve it.
// If processProductImage successfully uploaded it to a GCS bucket, that
// real URL (set as file.publicUrl) is used. Otherwise it falls back to this
// server's own /uploads static route — never a guessed bucket URL for a
// file that was never actually sent to a bucket (that mismatch was why
// uploaded images weren't showing up on the storefront).
function toPublicUrl(req, file) {
  if (file.publicUrl?.startsWith("gs://")) {
    const objectName = file.publicUrl.split("/").slice(3).join("/");
    return `${req.protocol}://${req.get("host")}/api/products/assets/${encodeURIComponent(objectName)}`;
  }
  if (file.publicUrl) return file.publicUrl;
  return `${req.protocol}://${req.get("host")}/uploads/${file.filename}`;
}

// Permanent application URL for a private product image. GCS remains private;
// this endpoint is the controlled reader for the storefront.
router.get("/assets/:objectName", async (req, res, next) => {
  try {
    const objectName = decodeURIComponent(req.params.objectName);
    const folder = process.env.STORAGE_FOLDER || "bucket";
    if (objectName.includes("/") && !objectName.startsWith(`${folder}/`)) {
      return res.status(404).end();
    }
    if (!objectName.startsWith(`${folder}/`)) return res.status(404).end();
    if (!(await downloadObject(objectName, res))) return res.status(404).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/products/digital-file/resumable-upload (protected — dashboard only)
// Starts a GCS resumable-upload session. The browser then sends the ZIP
// directly to GCS in chunks, so the bytes never pass through Express/App
// Engine's 32MB request-size limit. Unlike a V4 signed URL, this is not a
// two-hour download/upload URL. The session URI exists only for this upload;
// the stored product file itself remains private and does not expire.
// ---------------------------------------------------------------------------
router.post("/digital-file/resumable-upload", requireAuth, async (req, res, next) => {
  try {
    if (!bucketConfigured()) {
      return res.status(500).json({
        error: "Direct uploads require GCS to be configured (STORAGE_BUCKET).",
      });
    }

    const { originalName, contentType, size } = req.body || {};
    const totalSize = Number(size);

    if (!originalName || !/\.zip$/i.test(originalName)) {
      return res.status(400).json({ error: "originalName must be a .zip filename" });
    }
    if (!Number.isSafeInteger(totalSize) || totalSize <= 0 || totalSize > 1000 * 1024 * 1024) {
      return res.status(400).json({ error: "ZIP size must be between 1 byte and 1000MB" });
    }

    const destFilename = `digital/${nanoid(14)}.zip`;
    // IMPORTANT: GCS uses the Origin from the session-initiation request
    // when deciding whether subsequent 308 resumable-upload responses get
    // CORS headers. Passing a fixed localhost:3000 origin breaks a dashboard
    // actually running on localhost:5173 (the common Vite dev origin).
    const requestOrigin = req.get("Origin") || process.env.DASHBOARD_ORIGIN || undefined;

    const { sessionUri, objectName } = await createResumableUploadSession(
      destFilename,
      contentType || "application/zip",
      totalSize,
      requestOrigin
    );

    res.json({
      data: {
        uploadUrl: sessionUri,
        objectName,
        originalName,
        size: totalSize,
      },
    });
  } catch (err) {
    next(err);
  }
});


// Public serializer: never leak the internal storage filename for the
// digital bundle — only enough metadata to show "what you get" on the
// product page. The real file is only ever reachable through the gated,
// auth+purchase-checked download route in routes/orders.js.
function serialize(product) {
  const obj = product.toJSON ? product.toJSON() : product;
  const { digitalFile, reviews = [], ...rest } = obj;

  const reviewCount = reviews.length;
  const rating = reviewCount
    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
    : null;

  // Newest first for display on the storefront.
  const sortedReviews = [...reviews].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  return {
    ...rest,
    reviews: sortedReviews,
    rating,
    reviewCount,
    hasDigitalFile: Boolean(digitalFile),
    digitalFile: digitalFile
      ? { originalName: digitalFile.originalName, size: digitalFile.size }
      : null,
  };
}

// Builds the digitalFile subdocument from either upload path.
// `body.digitalFileGcs` arrives as a JSON string (form fields are always
// strings in multipart bodies) shaped like
// { objectName, originalName, size }, produced by the resumable-upload flow.
function parseDigitalFileField(body, multerFile) {
  if (multerFile) {
    return {
      fileName: multerFile.filename,
      originalName: multerFile.originalname,
      size: multerFile.size,
      storage: "local",
      uploadedAt: new Date(),
    };
  }

  if (body?.digitalFileGcs) {
    let meta;
    try {
      meta = JSON.parse(body.digitalFileGcs);
    } catch {
      return null;
    }
    if (!meta?.objectName) return null;
    return {
      fileName: meta.objectName,
      originalName: meta.originalName || "download.zip",
      size: Number(meta.size) || 0,
      storage: "gcs",
      uploadedAt: new Date(),
    };
  }

  return null;
}

function isValidObjectId(id) {
  return /^[a-f\d]{24}$/i.test(String(id));
}

// ---------------------------------------------------------------------------
// GET /api/products
// Supports: ?search=&category=&style=&fabric=&brand=&minPrice=&maxPrice=
//           &sort=price_asc|price_desc|newest|name_asc&page=&limit=
// This single endpoint powers the storefront's product grid AND the
// dashboard's inventory table — same data, same filters, no duplication.
// ---------------------------------------------------------------------------
router.get("/", async (req, res, next) => {
  try {
    const {
      search,
      category,
      style,
      fabric,
      brand,
      minPrice,
      maxPrice,
      sort,
      page = 1,
      limit = 50,
      featured,
    } = req.query;

    const query = {};

    if (search) {
      const re = new RegExp(String(search).trim(), "i");
      query.$or = [{ name: re }, { description: re }, { sku: re }];
    }
    if (category) {
      query.category = new RegExp(`^${category}$`, "i");
    } else {
      // Without an explicit category filter, keep Design Patterns out of the
      // main storefront grid/search — they live on their own /design-patterns
      // page. Passing ?category=Design%20Patterns explicitly still works.
      query.category = { $ne: DESIGN_PATTERN_CATEGORY };
    }
    if (style) query.style = new RegExp(`^${style}$`, "i");
    if (fabric) query.fabric = new RegExp(`^${fabric}$`, "i");
    if (brand) query.brand = new RegExp(`^${brand}$`, "i");
    if (featured === "true" || featured === "1") query.featured = true;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    let sortSpec = { createdAt: -1 };
    switch (sort) {
      case "price_asc":
        sortSpec = { price: 1 };
        break;
      case "price_desc":
        sortSpec = { price: -1 };
        break;
      case "name_asc":
        sortSpec = { name: 1 };
        break;
      case "newest":
      default:
        sortSpec = { createdAt: -1 };
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));

    const [items, total] = await Promise.all([
      Product.find(query)
        .sort(sortSpec)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Product.countDocuments(query),
    ]);

    res.json({
      data: items.map(serialize),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/products/meta — distinct filter values, used by both the
// storefront's filter bar and the dashboard's "Add Product" dropdowns.
router.get("/meta", async (req, res, next) => {
  try {
    const [taxonomyDocs, brands] = await Promise.all([
      Taxonomy.find({ active: true }).sort({ type: 1, sortOrder: 1, name: 1 }).lean(),
      Product.distinct("brand"),
    ]);

    const categories = taxonomyDocs.filter((item) => item.type === "category").map((item) => item.name);
    const styles = taxonomyDocs.filter((item) => item.type === "style").map((item) => item.name);
    const fabrics = taxonomyDocs.filter((item) => item.type === "fabric").map((item) => item.name);

    // Before taxonomy seeding, keep the endpoint useful for an existing database.
    if (!categories.length || !styles.length || !fabrics.length) {
      const [productCategories, productStyles, productFabrics] = await Promise.all([
        Product.distinct("category"), Product.distinct("style"), Product.distinct("fabric"),
      ]);
      if (!categories.length) categories.push(...productCategories.filter(Boolean).sort());
      if (!styles.length) styles.push(...productStyles.filter(Boolean).sort());
      if (!fabrics.length) fabrics.push(...productFabrics.filter(Boolean).sort());
    }

    res.json({
      categories: [...new Set(categories)],
      styles: [...new Set(styles)],
      fabrics: [...new Set(fabrics)],
      brands: brands.filter(Boolean).sort(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/products/:id/reviews (auth required)
// Only customers with a paid order containing this digital product may review it.
router.post("/:id/reviews", requireAuth, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: "Product not found" });

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (!product.digitalFile) return res.status(400).json({ error: "Only digital products can be reviewed" });

    const existingReview = product.reviews.find((review) => review.userId && String(review.userId) === String(req.user.sub));
    if (existingReview) return res.status(409).json({ error: "You have already reviewed this product" });

    const paidOrder = await Order.findOne({
      userId: req.user.sub,
      status: "paid",
      "items.productId": product._id,
    }).lean();
    if (!paidOrder) {
      return res.status(403).json({ error: "You can review this product after purchasing it." });
    }

    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || "").trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be a whole number from 1 to 5" });
    }
    if (!comment || comment.length < 3) return res.status(400).json({ error: "Please write a review" });
    if (comment.length > 1000) return res.status(400).json({ error: "Review must be 1000 characters or fewer" });

    product.reviews.push({
      userId: req.user.sub,
      reviewerName: req.user.name || "Customer",
      rating,
      comment,
      verifiedPurchase: true,
      createdAt: new Date(),
    });
    await product.save();

    const saved = product.reviews[product.reviews.length - 1];
    const review = saved.toObject ? saved.toObject() : saved;
    res.status(201).json({ data: review });
  } catch (err) {
    next(err);
  }
});

// GET /api/products/:id
router.get("/:id", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: "Product not found" });
    }
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json({ data: serialize(product) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/products  (protected — dashboard only)
// Accepts multipart/form-data (image file) OR plain JSON (image URL string).
// ---------------------------------------------------------------------------
router.post("/", requireAuth, productUpload, processProductImage, async (req, res, next) => {
  try {
    const body = req.body || {};

    if (!body.name || body.price === undefined) {
      return res.status(400).json({ error: "name and price are required" });
    }

    const imageFiles = req.files?.image || [];
    const fabricImageFile = req.files?.fabricImage?.[0];
    const galleryFiles = req.files?.images || [];
    const digitalFileUpload = req.files?.digitalFile?.[0];

    const heroImages = imageFiles.length
      ? imageFiles.map((f) => toPublicUrl(req, f))
      : body.image
      ? [body.image]
      : ["/images/NoImage.jpg"];
    const image = heroImages[0];
    const fabricImage = fabricImageFile
      ? toPublicUrl(req, fabricImageFile)
      : body.fabricImage || "";
    const images = galleryFiles.length
      ? galleryFiles.map((f) => toPublicUrl(req, f))
      : [];

    // Two ways a digital file can arrive:
    //  1. digitalFileGcs — JSON metadata for a file already PUT directly to
    //     GCS via the /digital-file/resumable-upload flow (used for large files,
    //     since it never touches this request handler's body size).
    //  2. digitalFileUpload — a normal multer-handled file in this request
    //     (kept for small files / backward compatibility; still capped by
    //     App Engine's 32MB request limit).
    const digitalFile = parseDigitalFileField(body, digitalFileUpload);

    const product = await Product.create({
      name: body.name,
      sku: body.sku || `FN-${nanoid(6).toUpperCase()}`,
      price: Number(body.price) || 0,
      category: body.category || "Uncategorized",
      brand: body.brand || "FabricNow",
      style: body.style || "",
      fabric: body.fabric || "",
      color: body.color || "",
      size: body.size || "",
      description: body.description || "",
      pinterestUrl: body.pinterestUrl || "",
      image,
      heroImages,
      fabricImage,
      images,
      digitalFile,
      featured: body.featured === "true" || body.featured === true,
      // Every new product launches with a handful of auto-generated,
      // 4.0–4.9 star reviews so it doesn't show up with zero social proof.
      reviews: generateReviews(),
    });

    res.status(201).json({ data: serialize(product) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/products/:id (protected)
router.put("/:id", requireAuth, productUpload, processProductImage, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: "Product not found" });
    }

    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Product not found" });

    const body = req.body || {};
    const imageFiles = req.files?.image || [];
    const fabricImageFile = req.files?.fabricImage?.[0];
    const galleryFiles = req.files?.images || [];
    const digitalFileUpload = req.files?.digitalFile?.[0];

    // Only replace the hero set when new files are actually sent — otherwise
    // keep whatever's already on the product. Older products saved before
    // heroImages existed only have `image`; fall back to that as a
    // single-item set so they keep working.
    const existingHeroImages =
      existing.heroImages && existing.heroImages.length ? existing.heroImages : [existing.image];
    const heroImages = imageFiles.length
      ? imageFiles.map((f) => toPublicUrl(req, f))
      : body.image !== undefined
      ? [body.image]
      : existingHeroImages;
    const image = heroImages[0];
    const fabricImage = fabricImageFile
      ? toPublicUrl(req, fabricImageFile)
      : body.fabricImage ?? existing.fabricImage;
    // Only replace the gallery when new files are actually sent — otherwise
    // keep whatever gallery shots already exist on the product.
    const images = galleryFiles.length
      ? galleryFiles.map((f) => toPublicUrl(req, f))
      : existing.images;

    let digitalFile = existing.digitalFile || null;
    const parsed = parseDigitalFileField(body, digitalFileUpload);
    if (parsed) {
      digitalFile = parsed;
    } else if (body.clearDigitalFile === "true" || body.clearDigitalFile === true) {
      digitalFile = null;
    }

    existing.name = body.name ?? existing.name;
    existing.sku = body.sku ?? existing.sku;
    existing.price = body.price !== undefined ? Number(body.price) : existing.price;
    existing.category = body.category ?? existing.category;
    existing.brand = body.brand ?? existing.brand;
    existing.style = body.style ?? existing.style;
    existing.fabric = body.fabric ?? existing.fabric;
    existing.color = body.color ?? existing.color;
    existing.size = body.size ?? existing.size;
    existing.description = body.description ?? existing.description;
    existing.pinterestUrl = body.pinterestUrl ?? existing.pinterestUrl;
    existing.image = image;
    existing.heroImages = heroImages;
    existing.fabricImage = fabricImage;
    existing.images = images;
    existing.digitalFile = digitalFile;
    existing.featured =
      body.featured !== undefined ? body.featured === "true" || body.featured === true : existing.featured;

    await existing.save();

    res.json({ data: serialize(existing) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/products/:id (protected)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: "Product not found" });
    }

    const removed = await Product.findByIdAndDelete(req.params.id);
    if (!removed) return res.status(404).json({ error: "Product not found" });

    res.json({ data: serialize(removed) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Design Patterns — a Product (same price/name/description/zip-download
// flow) whose display image is auto-traced from an uploaded PNG into an SVG
// instead of being cropped/resized like a normal fabric photo.
// ---------------------------------------------------------------------------

// Tracing a full-size image is the heaviest thing this public route does —
// throttle per-IP so it can't be hammered into a CPU sink (same pattern as
// Fibo's rate limit in routes/assistant.js).
const svgPreviewRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  message: "This tool is getting a lot of use right now — please wait a moment and try again.",
});

// POST /api/products/design-patterns/preview (public — no auth required)
// multipart/form-data: image (PNG/JPG/WEBP).
//
// Lets a visitor try the PNG -> SVG tracer live, on their own artwork,
// right on the storefront — before ever creating an account or buying
// anything. Nothing here is saved as a Product or written to permanent
// storage: the upload and the traced-SVG file potrace writes to disk are
// both deleted the moment the response is sent, and only the SVG markup
// itself goes back to the browser.
router.post(
  "/design-patterns/preview",
  svgPreviewRateLimit,
  svgPreviewUpload.single("image"),
  async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded. Field name must be "image".' });
    }

    const uploadPath = req.file.path;
    let tracedPath = null;
    const cleanup = () => {
      fs.unlink(uploadPath, () => {});
      if (tracedPath) fs.unlink(tracedPath, () => {});
    };

    try {
      const { svg, filePath } = await convertPngToSvg(uploadPath, os.tmpdir());
      tracedPath = filePath;
      res.json({ svg });
    } catch (err) {
      next(err);
    } finally {
      cleanup();
    }
  }
);

// POST /api/products/design-patterns (protected — dashboard only)
// multipart/form-data: name, price, description, image (PNG), digitalFile
// (.zip) or digitalFileGcs (JSON metadata from the resumable-upload flow).
router.post(
  "/design-patterns",
  requireAuth,
  designPatternUpload,
  async (req, res, next) => {
    try {
      const body = req.body || {};
      if (!body.name || body.price === undefined) {
        return res.status(400).json({ error: "name and price are required" });
      }

      const imageFile = req.files?.image?.[0];
      const digitalFileUpload = req.files?.digitalFile?.[0];
      let digitalFile = parseDigitalFileField(body, digitalFileUpload);

      let image = body.image || "/images/NoImage.jpg";
      if (imageFile) {
        // Trace the uploaded PNG into an SVG (deterministic bitmap tracing,
        // see lib/svgConvert.js — no AI involved).
        const { filename: svgFilename, filePath: svgFilePath } = await convertPngToSvg(
          imageFile.path,
          UPLOAD_DIR
        );

        // No .zip was explicitly uploaded — bundle the original raster +
        // the traced SVG into one automatically, so the admin never has to
        // attach a .zip by hand for a Design Pattern. This has to happen
        // BEFORE publishing (and possibly deleting the local copy of) the
        // SVG below, since the zip step still needs that local file to read.
        if (!digitalFile) {
          const baseName = safeFileBase(body.name) || "design-pattern";
          const rasterExt = path.extname(imageFile.originalname) || ".png";
          const { filename: zipFilename, filePath: zipFilePath, size } = await buildImageBundleZip(
            {
              rasterPath: imageFile.path,
              rasterName: `${baseName}${rasterExt}`,
              svgPath: svgFilePath,
              svgName: `${baseName}.svg`,
            },
            DIGITAL_DIR
          );
          const published = await publishGeneratedDigitalFile(zipFilePath, zipFilename);
          digitalFile = {
            ...published,
            originalName: `${baseName}.zip`,
            size,
            uploadedAt: new Date(),
          };
        }

        // Now that the zip (if any) has what it needs, publish the SVG
        // itself — uploads to the configured GCS bucket when available,
        // dropping the local copy since App Engine's local disk is
        // ephemeral (see publishGeneratedImage above).
        image = await publishGeneratedImage(req, svgFilePath, svgFilename);

        // The raw upload was only needed to produce the SVG and the zip —
        // don't keep a standalone copy of it around.
        fs.unlink(imageFile.path, () => {});
      }

      const product = await Product.create({
        name: body.name,
        sku: body.sku || `DP-${nanoid(6).toUpperCase()}`,
        price: Number(body.price) || 0,
        category: DESIGN_PATTERN_CATEGORY,
        brand: body.brand || "FabricNow",
        description: body.description || "",
        pinterestUrl: body.pinterestUrl || "",
        image,
        heroImages: [image],
        digitalFile,
        featured: body.featured === "true" || body.featured === true,
        reviews: generateReviews(),
      });

      res.status(201).json({ data: serialize(product) });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/products/design-patterns/:id (protected)
// Same as above, but updates an existing Design Pattern. A new PNG is only
// re-traced/replaced if one is actually uploaded; otherwise the existing
// SVG stays as-is.
router.put(
  "/design-patterns/:id",
  requireAuth,
  designPatternUpload,
  async (req, res, next) => {
    try {
      if (!isValidObjectId(req.params.id)) {
        return res.status(404).json({ error: "Product not found" });
      }
      const existing = await Product.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Product not found" });

      const body = req.body || {};
      const imageFile = req.files?.image?.[0];
      const digitalFileUpload = req.files?.digitalFile?.[0];

      let image = existing.image;
      let digitalFile = existing.digitalFile || null;
      const parsed = parseDigitalFileField(body, digitalFileUpload);

      if (imageFile) {
        const { filename: svgFilename, filePath: svgFilePath } = await convertPngToSvg(
          imageFile.path,
          UPLOAD_DIR
        );

        if (parsed) {
          // An explicit new .zip was uploaded alongside the new image —
          // that takes precedence over auto-bundling.
          digitalFile = parsed;
        } else if (!digitalFileUpload && !body.digitalFileGcs) {
          // No new .zip was provided for this edit — re-bundle the
          // (possibly replaced) raster + freshly-traced SVG automatically,
          // same as on create. Has to happen before the SVG is
          // published/deleted below, since it still needs that local file.
          const baseName = safeFileBase(body.name ?? existing.name) || "design-pattern";
          const rasterExt = path.extname(imageFile.originalname) || ".png";
          const { filename: zipFilename, filePath: zipFilePath, size } = await buildImageBundleZip(
            {
              rasterPath: imageFile.path,
              rasterName: `${baseName}${rasterExt}`,
              svgPath: svgFilePath,
              svgName: `${baseName}.svg`,
            },
            DIGITAL_DIR
          );
          const published = await publishGeneratedDigitalFile(zipFilePath, zipFilename);
          digitalFile = {
            ...published,
            originalName: `${baseName}.zip`,
            size,
            uploadedAt: new Date(),
          };
        }

        image = await publishGeneratedImage(req, svgFilePath, svgFilename);
        fs.unlink(imageFile.path, () => {});
      } else if (parsed) {
        digitalFile = parsed;
      } else if (body.clearDigitalFile === "true" || body.clearDigitalFile === true) {
        digitalFile = null;
      }

      existing.name = body.name ?? existing.name;
      existing.price = body.price !== undefined ? Number(body.price) : existing.price;
      existing.description = body.description ?? existing.description;
      existing.pinterestUrl = body.pinterestUrl ?? existing.pinterestUrl;
      existing.image = image;
      existing.heroImages = [image];
      existing.digitalFile = digitalFile;
      existing.category = DESIGN_PATTERN_CATEGORY;

      await existing.save();
      res.json({ data: serialize(existing) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;