const { Schema, model } = require('mongoose');
// A flat-sketch design in the company's Pattern Library. The sketch itself is drawn by the app from `spec`,
// so a design is small, editable and never depends on stored images.
const schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  createdBy: { type: String },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, enum: ['tops', 'dresses', 'skirts', 'trousers', 'jackets', 'traditional'], default: 'tops' },
  description: { type: String, default: '', maxlength: 600 },
  tags: { type: [String], default: [] },
  spec: { type: Schema.Types.Mixed, required: true },
  source: { type: String, enum: ['starter', 'ai', 'photo', 'duplicate', 'manual'], default: 'manual' },
  prompt: { type: String, default: '', maxlength: 1000 },
  sizeLabel: { type: String, default: 'M' },
  notes: { type: String, default: '', maxlength: 2000 },
  favorite: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
}, { timestamps: true });
schema.index({ companyId: 1, updatedAt: -1 });
schema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; } });
module.exports = model('PatternDesign', schema);
