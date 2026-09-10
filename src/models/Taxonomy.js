const { Schema, model } = require("mongoose");

const taxonomySchema = new Schema(
  {
    type: { type: String, enum: ["category", "style", "fabric"], required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

taxonomySchema.index({ type: 1, slug: 1 }, { unique: true });
taxonomySchema.index({ type: 1, sortOrder: 1, name: 1 });

taxonomySchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = model("Taxonomy", taxonomySchema);
