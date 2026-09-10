const { Schema, model } = require("mongoose");

const digitalFileSchema = new Schema(
  {
    fileName: String, // internal storage filename/GCS object name — never sent to the storefront
    originalName: String,
    size: Number,
    // "gcs" for files uploaded via the direct GCS upload flow, "local" (or
    // unset, for older records) for files sitting on local App Engine disk.
    storage: { type: String, enum: ["gcs", "local"], default: "local" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reviewSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewerName: { type: String, required: true, trim: true },
    // Kept within 4.0–4.9 by the generator in src/lib/reviews.js.
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "", trim: true },
    verifiedPurchase: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    price: { type: Number, required: true, default: 0 },
    category: { type: String, default: "Uncategorized", trim: true },
    brand: { type: String, default: "FabricNow", trim: true },
    style: { type: String, default: "", trim: true },
    fabric: { type: String, default: "", trim: true },
    color: { type: String, default: "", trim: true },
    size: { type: String, default: "", trim: true },
    description: { type: String, default: "" },
    // Link to this product's pin on Pinterest — shown as a "View on Pinterest"
    // icon/button on the storefront product page when set. Optional.
    pinterestUrl: { type: String, default: "", trim: true },
    // Primary hero shot — the fabric shown made up / worn on an AI model.
    // Kept in sync with heroImages[0] for any code that only reads this
    // single field (cart line items, product cards, etc.).
    image: { type: String, default: "/images/NoImage.jpg" },
    // Full set of "on model" hero shots (1 or more) — these auto-swipe
    // together on the storefront product page, alongside fabricImage.
    heroImages: { type: [String], default: [] },
    // Close-up of the fabric itself (swatch/texture), shown as its own main image.
    fabricImage: { type: String, default: "" },
    // Gallery of additional on-model shots — the same garment styled/posed
    // different ways, shown as sub-images the shopper can click through.
    images: { type: [String], default: [] },
    digitalFile: { type: digitalFileSchema, default: null },
    featured: { type: Boolean, default: false },
    // Auto-generated (4.0–4.9) at creation time — see src/lib/reviews.js.
    reviews: { type: [reviewSchema], default: [] },
  },
  { timestamps: true }
);

productSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = model("Product", productSchema);